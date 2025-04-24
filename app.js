// app.js
console.log('app.js loaded');

// Pallet constraints
const PALLET_L        = 120;  // cm
const PALLET_W        =  80;  // cm
const PALLET_MAX_H    = 170;  // cm
const PALLET_EMPTY_WT =  25;  // kg

let productsBySku = {};

function parseDims(str) {
  const parts = str.split(/[x×]/i).map(Number);
  return { l: parts[0], w: parts[1], h: parts[2] };
}

// 1) Load master data
window.addEventListener('DOMContentLoaded', async () => {
  console.log('Fetching products-detail.json…');
  try {
    const r = await fetch('products-detail.json');
    const data = await r.json();
    // assume array at top level
    data.forEach(p => {
      productsBySku[p.REF] = {
        name:       p.PRODUCT,
        fragility:  p["Resistance Level (Fragile / Medium / Strong)"].toLowerCase(),
        box1Units:    Number(p["Box 1 Units"])        || 0,
        box1Weight:   Number(p["Box 1 Weight (kg)"])  || 0,
        box1Orient:   p["Box 1 Orientation (Horizontal / Both)"].toLowerCase(),
        box1Dims:     parseDims(p["Box 1 Dimensions (cm) (LxDxH)"]),
        box2Units:    Number(p["Box 2 Units"])        || 0,
        box2Weight:   Number(p["Box 2 Weight (kg)"])  || 0,
        box2Orient:   p["Box 2 Orientation (Horizontal / Both)"].toLowerCase(),
        box2Dims:     parseDims(p["Box 2 Dimensions (cm) (LxDxH)"])
      };
    });
    console.log('Master data loaded:', Object.keys(productsBySku).length, 'SKUs');
  } catch (e) {
    console.error('Error loading master data', e);
    alert('Could not load product master data.');
  }
});

// 2) Read order file
function readOrderFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header:1, blankrows:false });
        const header = rows.find(r =>
          r.includes('REF') &&
          r.includes('BOX USED (BOX1 or BOX2)') &&
          r.includes('ORDER IN UNITS')
        );
        const iREF   = header.indexOf('REF');
        const iBOX   = header.indexOf('BOX USED (BOX1 or BOX2)');
        const iUNITS = header.indexOf('ORDER IN UNITS');
        const lines = [];
        for (let i = rows.indexOf(header) + 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r[iREF]) break;
          lines.push({
            sku:     r[iREF].toString().trim(),
            boxKey:  r[iBOX].toString().trim().toLowerCase(),
            units:   Number(r[iUNITS]) || 0
          });
        }
        resolve(lines);
      } catch (err) {
        reject(err);
      }
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsBinaryString(file);
  });
}

// 3) Grid solver (5+2)
function bestSingleGridCount(dims, canRotate) {
  const Lp = PALLET_L, Wp = PALLET_W;
  let best = 0;
  const opts = [{ l:dims.l, w:dims.w }];
  if (canRotate) opts.push({ l:dims.w, w:dims.l });
  opts.forEach((o1,i1) => {
    const rows = Math.floor(Lp / o1.l);
    const cols = Math.floor(Wp / o1.w);
    const base = rows * cols;
    const remL = Lp - rows*o1.l;
    const remW = Wp - cols*o1.w;
    let extra = 0;
    opts.forEach((o2,i2) => {
      if (i1===i2) return;
      const c1 = Math.floor(remL / o2.l) * Math.floor(Wp / o2.w);
      const c2 = Math.floor(Lp / o2.l) * Math.floor(remW / o2.w);
      extra = Math.max(extra, c1 + c2);
    });
    best = Math.max(best, base + extra);
  });
  return best;
}

// 4) Pack one layer
function packLayer(instances) {
  if (!instances.length) return { placed:[], notPlaced:[] };
  const sku0 = instances[0].sku;
  if (instances.every(x=>x.sku===sku0)) {
    const pd = productsBySku[sku0];
    const dims = pd[instances[0].boxKey+'Dims'];
    const orient = pd[instances[0].boxKey+'Orient']==='both';
    const maxBoxes = bestSingleGridCount(dims, orient);
    const take = Math.min(maxBoxes, instances.length);
    return {
      placed: instances.slice(0,take).map(b=>({ box:b })),
      notPlaced: instances.slice(take)
    };
  }
  let free = [{x:0,y:0,w:PALLET_L,h:PALLET_W}];
  let rem = [...instances], placed = [];
  instances.forEach(inst => {
    const pd = productsBySku[inst.sku];
    const dims = pd[inst.boxKey+'Dims'];
    const orient = pd[inst.boxKey+'Orient']==='both';
    const opts = [{l:dims.l,w:dims.w}];
    if (orient) opts.push({l:dims.w,w:dims.l});
    let slot=null, d=null;
    outer: for (let r of free) {
      for (let o of opts) {
        if (o.l<=r.w && o.w<=r.h) { slot=r; d=o; break outer; }
      }
    }
    if (!slot) return;
    placed.push({ box:inst, dims:d });
    rem = rem.filter(x=>x!==inst);
    free = free.filter(r=>r!==slot);
    free.push(
      { x:slot.x+d.l, y:slot.y,        w:slot.w-d.l, h:d.w },
      { x:slot.x,       y:slot.y+d.w,  w:slot.w,     h:slot.h-d.w }
    );
  });
  return { placed, notPlaced:rem };
}

// 5) Optimize
async function optimize() {
  const cust = document.getElementById('customer').value.trim();
  if (!cust) return alert('Enter customer name');
  const fi = document.getElementById('fileInput');
  if (!fi.files.length) return alert('Select order file');
  let lines;
  try { lines = await readOrderFile(fi.files[0]); }
  catch(e){ return alert('File read error: '+e.message); }
  if (!lines.length) {
    return document.getElementById('results').innerHTML =
      '<p><em>No valid order lines found.</em></p>';
  }

  // expand to box instances
  let insts = [];
  lines.forEach(l => {
    const pd = productsBySku[l.sku];
    if (!pd) return;
    const cap = pd[l.boxKey+'Units'];
    const cnt = Math.ceil(l.units / cap);
    for (let i=0;i<cnt;i++) {
      insts.push({
        sku: l.sku,
        name: pd.name,
        boxKey: l.boxKey,
        weight: pd[l.boxKey+'Weight'],
        dims: pd[l.boxKey+'Dims'],
        canRotate: pd[l.boxKey+'Orient']==='both'
      });
    }
  });
  if (!insts.length) {
    return document.getElementById('results').innerHTML =
      '<p><em>No boxes after expansion.</em></p>';
  }

  // pack into pallets
  let rem = [...insts], pallets = [];
  while (rem.length) {
    let usedH = 0, wt = PALLET_EMPTY_WT, layers = [];
    while (true) {
      const { placed, notPlaced } = packLayer(rem);
      if (!placed.length) break;
      const h = Math.max(...placed.map(x=>x.box.dims.h));
      if (usedH + h > PALLET_MAX_H) break;
      usedH += h;
      wt += placed.reduce((s,x)=>s + x.box.weight,0);
      layers.push(placed);
      rem = notPlaced;
    }
    pallets.push({ layers, height:usedH, weight:wt });
  }

  // render
  let html = `<h1>${cust}</h1>`, grandWT=0;
  pallets.forEach((p,i) => {
    html += `<h2>PALLET ${i+1}</h2>`;
    let pUnits=0, pBoxes=0;
    p.layers.forEach((ly,li) => {
      html += `<h3>LAYER ${li+1}</h3>
        <table>
          <tr><th>SKU</th><th>Product</th>
              <th style="text-align:right">Units</th>
              <th>Box</th><th style="text-align:right">Count</th>
          </tr>`;
      const tally = {};
      ly.forEach(x=> tally[x.box.sku]=(tally[x.box.sku]||0)+1);
      for (let sku in tally) {
        const cnt = tally[sku], pd = productsBySku[sku],
              per = pd[ly[0].box.boxKey+'Units'],
              units = per * cnt;
        html += `<tr>
          <td>${sku}</td>
          <td>${pd.name}</td>
          <td style="text-align:right">${units}</td>
          <td>${ly[0].box.boxKey.toUpperCase()}</td>
          <td style="text-align:right">${cnt}</td>
        </tr>`;
        pUnits += units;
        pBoxes += cnt;
      }
      html += `</table>`;
    });
    html += `<p><strong>Summary pallet ${i+1}:</strong>
      ${pUnits} units | ${pBoxes} boxes |
      Weight: ${p.weight.toFixed(1)} kg |
      Height: ${p.height} cm</p>`;
    grandWT += p.weight;
  });
  html += `<h2>ORDER RESUME</h2>
    <p>Total pallets: ${pallets.length}<br>
       Total weight: ${grandWT.toFixed(1)} kg</p>`;

  document.getElementById('results').innerHTML = html;
}

document.getElementById('go').addEventListener('click', optimize);
