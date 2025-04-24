// app.js

// --- Pallet constraints ---
const PALLET_L       = 120;  // cm (length)
const PALLET_W       =  80;  // cm (width)
const PALLET_MAX_H   = 170;  // cm (max stacked height)
const PALLET_EMPTY_WT = 25;  // kg (pallet itself)

// Global product master-data mapping: sku → spec
let productsBySku = {};

// Helper to parse "LxDxH" or "L×D×H" into { l, w, h }
function parseDims(str) {
  const parts = str.split(/[x×]/i).map(s => parseFloat(s));
  return { l: parts[0], w: parts[1], h: parts[2] };
}

// 1) Load product-detail.json on startup
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const resp = await fetch('products-detail.json');
    const data = await resp.json();

    // data may be an array of product objects
    data.forEach(p => {
      productsBySku[p.REF] = {
        name: p.PRODUCT,
        fragility: p["Resistance Level (Fragile / Medium / Strong)"].toLowerCase(),
        // Box1
        box1Units:        Number(p["Box 1 Units"])        || 0,
        box1Weight:       Number(p["Box 1 Weight (kg)"])  || 0,
        box1Orientation:  p["Box 1 Orientation (Horizontal / Both)"].toLowerCase(),
        box1Dims:         parseDims(p["Box 1 Dimensions (cm) (LxDxH)"]),
        // Box2
        box2Units:        Number(p["Box 2 Units"])        || 0,
        box2Weight:       Number(p["Box 2 Weight (kg)"])  || 0,
        box2Orientation:  p["Box 2 Orientation (Horizontal / Both)"].toLowerCase(),
        box2Dims:         parseDims(p["Box 2 Dimensions (cm) (LxDxH)"])
      };
    });

    document.getElementById('go').disabled = false;
  } catch (err) {
    console.error('Failed to load products-detail.json', err);
    alert('Could not load product master data.');
  }
});

// 2) Read and parse the uploaded order .xlsx
function readOrderFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });

        // locate header row
        const header = rows.find(r =>
          r.includes('REF') &&
          r.includes('BOX USED (BOX1 or BOX2)') &&
          r.includes('ORDER IN UNITS')
        );
        if (!header) throw new Error('Header row not found');

        const iREF   = header.indexOf('REF');
        const iBOX   = header.indexOf('BOX USED (BOX1 or BOX2)');
        const iUNITS = header.indexOf('ORDER IN UNITS');

        const lines = [];
        for (let i = rows.indexOf(header) + 1; i < rows.length; i++) {
          const r = rows[i];
          const rawRef = r[iREF];
          if (!rawRef || !rawRef.toString().trim()) break;
          lines.push({
            sku:     rawRef.toString().trim(),
            boxKey:  r[iBOX].toString().trim().toLowerCase(), // "box1" or "box2"
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

// 3) Compute optimal count for a single-SKU layer (try both orientations + leftover strips)
function bestSingleGridCount(dims, canRotate) {
  const Lp = PALLET_L, Wp = PALLET_W;
  const opts = [{ l: dims.l, w: dims.w }];
  if (canRotate) opts.push({ l: dims.w, w: dims.l });

  let best = 0;
  opts.forEach((o1, i1) => {
    const rows = Math.floor(Lp / o1.l);
    const cols = Math.floor(Wp / o1.w);
    const base = rows * cols;

    const remL = Lp - rows * o1.l;
    const remW = Wp - cols * o1.w;

    let extra = 0;
    opts.forEach((o2, i2) => {
      if (i2 === i1) return;
      const c1 = Math.floor(remL / o2.l) * Math.floor(Wp / o2.w);
      const c2 = Math.floor(Lp / o2.l) * Math.floor(remW / o2.w);
      extra = Math.max(extra, c1 + c2);
    });

    best = Math.max(best, base + extra);
  });

  return best;
}

// 4) Pack a single layer: single-SKU grid or mixed-SKU guillotine
function packLayer(instances) {
  if (!instances.length) return { placed: [], notPlaced: [] };

  // single-SKU?
  const sku0 = instances[0].sku;
  if (instances.every(x => x.sku === sku0)) {
    const pd = productsBySku[sku0];
    const dims = (instances[0].boxKey === 'box2' ? pd.box2Dims : pd.box1Dims);
    const canR = (instances[0].boxKey === 'box2' ? pd.box2Orientation : pd.box1Orientation) === 'both';
    const maxBoxes = bestSingleGridCount(dims, canR);
    const take = Math.min(maxBoxes, instances.length);
    const placed = instances.slice(0, take).map(inst => ({ box: inst }));
    const notPlaced = instances.slice(take);
    return { placed, notPlaced };
  }

  // mixed-SKU: simple guillotine
  let free = [{ x:0, y:0, w:PALLET_L, h:PALLET_W }];
  const placed = [];
  let rem = [...instances];

  instances.forEach(inst => {
    const pd = productsBySku[inst.sku];
    const { l, w } = (inst.boxKey === 'box2' ? pd.box2Dims : pd.box1Dims);
    const canR = (inst.boxKey === 'box2' ? pd.box2Orientation : pd.box1Orientation) === 'both';
    const opts = [{ l, w }];
    if (canR) opts.push({ l:w, w:l });

    let slot = null, dims = null;
    outer: for (let r of free) {
      for (let o of opts) {
        if (o.l <= r.w && o.w <= r.h) {
          slot = r; dims = o;
          break outer;
        }
      }
    }
    if (!slot) return;

    placed.push({ box: inst, dims });
    rem = rem.filter(x => x !== inst);
    free = free.filter(r => r !== slot);

    free.push(
      { x: slot.x + dims.l, y: slot.y,       w: slot.w - dims.l, h: dims.w },
      { x: slot.x,          y: slot.y + dims.w, w: slot.w,         h: slot.h - dims.w }
    );
  });

  return { placed, notPlaced: rem };
}

// 5) Main optimize routine
async function optimize() {
  const customer = document.getElementById('customer').value.trim();
  const fileEl   = document.getElementById('fileInput');
  const results  = document.getElementById('results');
  results.innerHTML = '';

  if (!customer) {
    alert('Please enter a customer name.');
    return;
  }
  if (!fileEl.files.length) {
    alert('Please select an order file.');
    return;
  }

  let lines;
  try {
    lines = await readOrderFile(fileEl.files[0]);
  } catch (err) {
    console.error(err);
    alert('Error reading order file: ' + err.message);
    return;
  }
  if (!lines.length) {
    results.innerHTML = '<p><em>No valid order lines found.</em></p>';
    return;
  }

  // expand each line into box instances
  let instances = [];
  lines.forEach(line => {
    const pd = productsBySku[line.sku];
    if (!pd) return;
    const cap = (line.boxKey === 'box2' ? pd.box2Units : pd.box1Units);
    const count = Math.ceil(line.units / cap);
    for (let i = 0; i < count; i++) {
      instances.push({
        sku:     line.sku,
        name:    pd.name,
        boxKey:  line.boxKey,
        weight:  (line.boxKey === 'box2' ? pd.box2Weight : pd.box1Weight),
        dims:    (line.boxKey === 'box2' ? pd.box2Dims : pd.box1Dims),
        canRotate: (line.boxKey === 'box2'
          ? pd.box2Orientation
          : pd.box1Orientation) === 'both'
      });
    }
  });

  if (!instances.length) {
    results.innerHTML = '<p><em>No boxes to pack after expansion.</em></p>';
    return;
  }

  // pack into pallets
  let rem = [...instances];
  const pallets = [];
  while (rem.length) {
    const layers = [];
    let usedH = 0, totalW = PALLET_EMPTY_WT;

    while (true) {
      const { placed, notPlaced } = packLayer(rem);
      if (!placed.length) break;
      const layerH = Math.max(...placed.map(x => x.box.dims.h));
      if (usedH + layerH > PALLET_MAX_H) break;
      usedH += layerH;
      totalW += placed.reduce((sum, x) => sum + x.box.weight, 0);
      layers.push(placed);
      rem = notPlaced;
    }

    pallets.push({ layers, height: usedH, weight: totalW });
  }

  // render output
  let html = `<h1>${customer}</h1>`;
  let grandTotalWeight = 0;

  pallets.forEach((p, pi) => {
    html += `<h2>PALLET ${pi+1}</h2>`;
    let palletUnits = 0, palletBoxes = 0;

    p.layers.forEach((layer, li) => {
      html += `<h3>LAYER ${li+1}</h3>`;
      html += `<table>
        <tr><th>SKU</th><th>Product</th><th>Units</th><th>Box</th><th>Count</th></tr>`;

      // tally boxes by SKU
      const tally = {};
      layer.forEach(x => tally[x.box.sku] = (tally[x.box.sku]||0) + 1);

      for (let sku in tally) {
        const count = tally[sku];
        const pd = productsBySku[sku];
        const perBox = (layer[0].box.boxKey==='box2' ? pd.box2Units : pd.box1Units);
        const units  = perBox * count;
        html += `<tr>
          <td>${sku}</td>
          <td>${pd.name}</td>
          <td style="text-align:right">${units}</td>
          <td>${layer[0].box.boxKey.toUpperCase()}</td>
          <td style="text-align:right">${count}</td>
        </tr>`;
        palletUnits += units;
        palletBoxes += count;
      }
      html += `</table>`;
    });

    html += `<p><strong>Summary pallet ${pi+1}:</strong>
      ${palletUnits} units | ${palletBoxes} boxes |
      Weight: ${p.weight.toFixed(1)} kg |
      Height: ${p.height} cm</p>`;

    grandTotalWeight += p.weight;
  });

  html += `<h2>ORDER RESUME</h2>
    <p>Total pallets: ${pallets.length}<br>
       Total weight: ${grandTotalWeight.toFixed(1)} kg</p>`;

  results.innerHTML = html;
}

// 6) wire up
document.getElementById('go').addEventListener('click', optimize);
