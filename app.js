// app.js

// ── Configuration ─────────────────────────────────────────────────────────────
const PALLET_L        = 120;  // cm (length)
const PALLET_W        =  80;  // cm (width)
const PALLET_MAX_H    = 170;  // cm max stack height
const PALLET_EMPTY_WT =  25;  // kg pallet weight

// ── Global master-data store ───────────────────────────────────────────────────
let productsBySku = {};

// ── Utility: parse "LxDxH" dimension strings ──────────────────────────────────
function parseDims(str="0x0x0") {
  const [l,w,h] = str.split(/[x×]/i).map(Number);
  return { l, w, h };
}

// ── 1) Load products-detail.json ────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const res  = await fetch('products-detail.json');
    const data = await res.json();

    // Normalize into an array of records
    let list;
    if (Array.isArray(data)) {
      list = data;
    } else {
      const keys = Object.keys(data);
      if (keys.length === 1 && Array.isArray(data[keys[0]])) {
        list = data[keys[0]];
      } else {
        list = Object.values(data);
      }
    }

    // Build lookup by REF (SKU)
    list.forEach(p => {
      productsBySku[p.REF] = {
        name:       p.PRODUCT,
        fragility:  (p["Resistance Level (Fragile / Medium / Strong)"] || '').toLowerCase(),

        // Box 1
        box1Units:   Number(p["Box 1 Units"])       || 0,
        box1Weight:  Number(p["Box 1 Weight (kg)"]) || 0,
        box1Orient:  (p["Box 1 Orientation (Horizontal / Both)"]||'').toLowerCase(),
        box1Dims:    parseDims(p["Box 1 Dimensions (cm) (LxDxH)"]),

        // Box 2
        box2Units:   Number(p["Box 2 Units"])       || 0,
        box2Weight:  Number(p["Box 2 Weight (kg)"]) || 0,
        box2Orient:  (p["Box 2 Orientation (Horizontal / Both)"]||'').toLowerCase(),
        box2Dims:    parseDims(p["Box 2 Dimensions (cm) (LxDxH)"])
      };
    });

    console.log('Loaded master data for SKUs:', Object.keys(productsBySku));
  } catch (err) {
    console.error('Failed to load products-detail.json', err);
    alert('Error loading product master data. Packing may not work.');
  }
});

// ── 2) Read and parse the uploaded order XLSX ───────────────────────────────────
function readOrderFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb    = XLSX.read(e.target.result, { type:'binary' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows  = XLSX.utils.sheet_to_json(sheet, { header:1, blankrows:false });

        // Locate header row
        const header = rows.find(r =>
          r.includes('REF') &&
          r.includes('BOX USED (BOX1 or BOX2)') &&
          r.includes('ORDER IN UNITS')
        );
        if (!header) throw new Error('Header row not found');

        const iREF   = header.indexOf('REF');
        const iBOX   = header.indexOf('BOX USED (BOX1 or BOX2)');
        const iUNITS = header.indexOf('ORDER IN UNITS');

        // Collect lines until blank REF cell
        const lines = [];
        for (let i = rows.indexOf(header)+1; i < rows.length; i++) {
          const r = rows[i];
          if (!r[iREF]) break;
          lines.push({
            sku:    r[iREF].toString().trim(),
            boxKey: r[iBOX].toString().trim().toLowerCase(), // "box1" or "box2"
            units:  Number(r[iUNITS]) || 0
          });
        }

        resolve(lines);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsBinaryString(file);
  });
}

// ── 3) Compute max same‐SKU count in one layer (5+2 grid) ──────────────────────
function bestSingleGridCount(dims, canRotate) {
  const Lp=PALLET_L, Wp=PALLET_W;
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
      if (i2 === i1) return;
      const c1 = Math.floor(remL / o2.l) * Math.floor(Wp / o2.w);
      const c2 = Math.floor(Lp / o2.l) * Math.floor(remW / o2.w);
      extra = Math.max(extra, c1 + c2);
    });

    best = Math.max(best, base + extra);
  });

  return best;
}

// ── 4) Pack a single layer ───────────────────────────────────────────────────────
function packLayer(instances) {
  if (!instances.length) return { placed:[], notPlaced:[] };

  // All same SKU?
  const sku0 = instances[0].sku;
  if (instances.every(x=>x.sku===sku0)) {
    const pd      = productsBySku[sku0];
    const dims    = pd[instances[0].boxKey + 'Dims'];
    const canRot  = (pd[instances[0].boxKey + 'Orient'] === 'both');
    const maxBoxes = bestSingleGridCount(dims, canRot);
    const take = Math.min(maxBoxes, instances.length);
    return {
      placed: instances.slice(0,take).map(box=>({ box })),
      notPlaced: instances.slice(take)
    };
  }

  // Mixed‐SKU => simple guillotine
  let free = [{ x:0,y:0,w:PALLET_L,h:PALLET_W }];
  let rem   = [...instances];
  const placed = [];

  instances.forEach(inst => {
    const pd      = productsBySku[inst.sku];
    const dims    = pd[inst.boxKey + 'Dims'];
    const canRot  = (pd[inst.boxKey + 'Orient'] === 'both');
    const opts    = [{ l:dims.l, w:dims.w }];
    if (canRot) opts.push({ l:dims.w, w:dims.l });

    let slot=null, d=null;
    outer: for (let r of free) {
      for (let o of opts) {
        if (o.l <= r.w && o.w <= r.h) {
          slot = r; d = o; break outer;
        }
      }
    }
    if (!slot) return;

    placed.push({ box:inst, dims:d });
    rem = rem.filter(x=>x!==inst);
    free = free.filter(r=>r!==slot);

    free.push(
      { x:slot.x + d.l, y:slot.y,       w:slot.w - d.l, h:d.w },
      { x:slot.x,       y:slot.y + d.w, w:slot.w,        h:slot.h - d.w }
    );
  });

  return { placed, notPlaced:rem };
}

// ── 5) Main optimize routine ───────────────────────────────────────────────────
async function optimize() {
  const cust = document.getElementById('customer').value.trim();
  if (!cust) { alert('Enter customer name'); return; }

  const fileEl = document.getElementById('fileInput');
  if (!fileEl.files.length) { alert('Select order file'); return; }

  let lines;
  try {
    lines = await readOrderFile(fileEl.files[0]);
  } catch (err) {
    alert('Error reading order: '+err.message);
    return;
  }
  if (!lines.length) {
    document.getElementById('results').innerHTML =
      '<p><em>No valid order lines found.</em></p>';
    return;
  }

  // Expand each line into box‐instances
  let instances = [];
  lines.forEach(l => {
    const pd = productsBySku[l.sku];
    if (!pd) return;
    const cap   = pd[l.boxKey + 'Units'];
    const count = Math.ceil(l.units / cap);
    for (let i=0; i<count; i++) {
      instances.push({
        sku:     l.sku,
        name:    pd.name,
        boxKey:  l.boxKey,
        weight:  pd[l.boxKey + 'Weight'],
        dims:    pd[l.boxKey + 'Dims'],
        canRotate: (pd[l.boxKey + 'Orient'] === 'both')
      });
    }
  });

  if (!instances.length) {
    document.getElementById('results').innerHTML =
      '<p><em>No boxes after expansion.</em></p>';
    return;
  }

  // Pack into pallets
  let rem = [...instances], pallets = [];
  while (rem.length) {
    let usedH = 0, totalWt = PALLET_EMPTY_WT;
    const layers = [];

    while (true) {
      const { placed, notPlaced } = packLayer(rem);
      if (!placed.length) break;
      const layerH = Math.max(...placed.map(x=>x.box.dims.h));
      if (usedH + layerH > PALLET_MAX_H) break;
      usedH    += layerH;
      totalWt  += placed.reduce((s,x)=>s + x.box.weight, 0);
      layers.push(placed);
      rem = notPlaced;
    }

    pallets.push({ layers, height:usedH, weight:totalWt });
  }

  // Render results
  let html = `<h1>${cust}</h1>`;
  let grandWt = 0;

  pallets.forEach((p,i) => {
    html += `<h2>PALLET ${i+1}</h2>`;
    let palUnits=0, palBoxes=0;

    p.layers.forEach((ly, li) => {
      html += `<h3>LAYER ${li+1}</h3>
        <table>
          <tr><th>SKU</th><th>Product</th>
              <th style="text-align:right">Units</th>
              <th>Box</th><th style="text-align:right">Count</th>
          </tr>`;

      const tally = {};
      ly.forEach(x=> tally[x.box.sku] = (tally[x.box.sku]||0) + 1);

      for (let sku in tally) {
        const cnt    = tally[sku];
        const pd     = productsBySku[sku];
        const per    = pd[ly[0].box.boxKey + 'Units'];
        const units  = per * cnt;
        html += `<tr>
          <td>${sku}</td>
          <td>${pd.name}</td>
          <td style="text-align:right">${units}</td>
          <td>${ly[0].box.boxKey.toUpperCase()}</td>
          <td style="text-align:right">${cnt}</td>
        </tr>`;
        palUnits += units;
        palBoxes += cnt;
      }

      html += `</table>`;
    });

    html += `<p><strong>Summary pallet ${i+1}:</strong> 
      ${palUnits} units | ${palBoxes} boxes |
      Weight: ${p.weight.toFixed(1)} kg |
      Height: ${p.height} cm</p>`;

    grandWt += p.weight;
  });

  html += `<h2>ORDER RESUME</h2>
    <p>Total pallets: ${pallets.length}<br>
       Total weight: ${grandWt.toFixed(1)} kg</p>`;

  document.getElementById('results').innerHTML = html;
}

// ── 6) Wire up the button ───────────────────────────────────────────────────────
document.getElementById('go').addEventListener('click', optimize);
