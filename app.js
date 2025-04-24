// app.js

// --- Pallet constraints ---
const PALLET_L      = 120;  // cm
const PALLET_W      =  80;  // cm
const PALLET_MAX_H  = 170;  // cm total stack height
const PALLET_MAX_WT = 600;  // kg including pallet
const PALLET_WT     =  25;  // kg empty pallet

let products = {};

// 1) Load master data
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch(`products-detail.json?cb=${Date.now()}`);
    products = await res.json();
  } catch (e) {
    console.error('Error loading products-detail.json', e);
    alert('Could not load product master data.');
  }
});

document.getElementById('go').addEventListener('click', async () => {
  const customer = document.getElementById('customer').value.trim();
  const fileIn   = document.getElementById('fileInput');
  if (!customer || !fileIn.files.length) {
    return alert('Enter a customer name and select an Excel file.');
  }

  // 2) Read the uploaded workbook & sheet
  const buf       = await fileIn.files[0].arrayBuffer();
  const wb        = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  const ws        = wb.Sheets[sheetName];

  // 3) Pull all rows as arrays
  const rows = XLSX.utils.sheet_to_json(ws, {
    header:    1,
    raw:       true,
    blankrows: false
  });

  // 4) Detect header row
  const labels = [
    'REF',
    'PRODUCT',
    'BOX USED (BOX1 OR BOX2)',
    'ORDER IN UNITS'
  ];
  let h = -1, ci = {};
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const up = rows[i].map(c =>
      c != null ? c.toString().toUpperCase().trim() : ''
    );
    if (labels.every(l => up.includes(l))) {
      h = i;
      ci = {
        REF:   up.indexOf('REF'),
        PROD:  up.indexOf('PRODUCT'),
        BOX:   up.indexOf('BOX USED (BOX1 OR BOX2)'),
        UNITS: up.indexOf('ORDER IN UNITS')
      };
      break;
    }
  }
  if (h < 0) {
    return alert('Could not find header row with REF / PRODUCT / BOX USED / ORDER IN UNITS.');
  }

  // 5) Build orders[]
  const orders = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r   = rows[i];
    const raw = r[ci.REF];
    if (raw == null || !raw.toString().trim()) break;
    const sku = raw.toString().trim();
    if (!products[sku]) continue;
    orders.push({
      sku,
      name:   r[ci.PROD]?.toString().trim() || sku,
      boxKey: r[ci.BOX]?.toString().trim().toLowerCase(),
      units:  Number(r[ci.UNITS]) || 0
    });
  }
  if (!orders.length) {
    return document.getElementById('output').innerHTML =
      '<p><em>No valid order lines found. Check your file.</em></p>';
  }

  // 6) Expand orders → instances
  let instances = [];
  orders.forEach(o => {
    const pd   = products[o.sku];
    const spec = pd[o.boxKey];
    if (!spec || !spec.units) {
      console.warn(`Missing spec for ${o.sku}→${o.boxKey}`);
      return;
    }
    const count = Math.ceil(o.units / spec.units);
    const [L,D,H] = spec.dimensions;
    for (let k=0; k<count; k++) {
      instances.push({
        sku:       o.sku,
        name:      o.name,
        fragility: pd.fragility.toLowerCase(),
        weight:    spec.weight,
        dims:      {l:L, w:D, h:H},
        canRotate: spec.orientation.toLowerCase()==='both'
      });
    }
  });
  if (!instances.length) {
    return document.getElementById('output').innerHTML =
      '<p><em>No boxes to pack after expansion.</em></p>';
  }

  // 7) Sort by fragility
  const fragOrder = { strong:0, medium:1, fragile:2 };
  instances.sort((a,b) => fragOrder[a.fragility] - fragOrder[b.fragility]);

  // 8) Pack into pallets
  let remaining = instances.slice(), pallets = [];
  while (remaining.length) {
    let usedH = 0, usedWT = PALLET_WT;
    const pal = { layers: [] };

    while (remaining.length) {
      const { placed, notPlaced } = packLayer(remaining);
      if (!placed.length) break;
      const layerH  = Math.max(...placed.map(x=>x.box.dims.h));
      const layerWT = placed.reduce((s,x)=>s + x.box.weight, 0);
      if (usedH + layerH > PALLET_MAX_H) break;
      if (usedWT + layerWT > PALLET_MAX_WT) break;
      pal.layers.push({ boxes: placed, height: layerH, weight: layerWT });
      usedH  += layerH;
      usedWT += layerWT;
      remaining = notPlaced;
    }

    pallets.push(pal);
  }

  // 9) Render full layout
  let html = `<h1>${customer}</h1>`;
  let totalBoxes=0, totalUnits=0, totalWT=0;

  pallets.forEach((p, idx) => {
    html += `<h2>PALLET ${idx+1}</h2>`;
    let pUnits=0, pBoxes=0, pWT=PALLET_WT, pH=0;

    p.layers.forEach((ly, li) => {
      html += `<h3>LAYER${li+1}</h3>
        <table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;">
          <thead>
            <tr><th>SKU</th><th>Product</th><th>Units</th><th>Box Type</th><th>Boxes Needed</th></tr>
          </thead>
          <tbody>`;

      const cnt = {};
      ly.boxes.forEach(b => cnt[b.box.sku] = (cnt[b.box.sku]||0) + 1);
      Object.entries(cnt).forEach(([sku, n]) => {
        const ord = orders.find(o=>o.sku===sku);
        const per = products[sku][ord.boxKey].units;
        const units = per * n;
        html += `<tr>
          <td>${sku}</td>
          <td>${ord.name}</td>
          <td style="text-align:right">${units}</td>
          <td>${ord.boxKey.toUpperCase()}</td>
          <td style="text-align:right">${n}</td>
        </tr>`;
        pUnits += units; pBoxes += n;
      });

      pWT += ly.weight;
      pH  += ly.height;
      html += `</tbody></table>`;
    });

    html += `<p><strong>Summary pallet ${idx+1}:</strong>
      ${pUnits} units | ${pBoxes} Boxes | 
      Total Weight: ${pWT.toFixed(1)} Kg | 
      Total Height: ${pH} cm</p>`;

    totalBoxes += pBoxes;
    totalUnits += pUnits;
    totalWT    += pWT;
  });

  html += `<h2>ORDER RESUME:</h2>
    <p>Total Pallets: ${pallets.length}<br>
       Total Weight: ${totalWT.toFixed(1)} Kg</p>`;

  document.getElementById('output').innerHTML = html;
});


// Compute best grid count of a single box type
function bestSingleGridCount(boxDims, canRotate) {
  const opts = [{l:boxDims.l, w:boxDims.w}];
  if (canRotate) opts.push({l:boxDims.w, w:boxDims.l});
  let best = 0;
  opts.forEach((o1,i1) => {
    const cols = Math.floor(PALLET_L / o1.l);
    const rows = Math.floor(PALLET_W / o1.w);
    const base = cols * rows;
    const remL = PALLET_L - cols * o1.l;
    const remW = PALLET_W - rows * o1.w;
    let extra = 0;
    opts.forEach((o2,i2) => {
      if (i2===i1) return;
      const c2 = Math.floor(remL / o2.l) * Math.floor(PALLET_W / o2.w);
      const c3 = Math.floor(PALLET_L / o2.l) * Math.floor(remW / o2.w);
      extra = Math.max(extra, c2 + c3);
    });
    best = Math.max(best, base + extra);
  });
  return best;
}

// Pack one layer: grid for single-SKU, guillotine otherwise
function packLayer(boxArray) {
  // detect single SKU
  if (boxArray.every(b => b.sku === boxArray[0].sku)) {
    const b0 = boxArray[0];
    const maxCount = bestSingleGridCount(b0.dims, b0.canRotate);
    const take = Math.min(maxCount, boxArray.length);
    const taken = boxArray.slice(0, take);
    return {
      placed: taken.map(inst => ({ box: inst })),
      notPlaced: boxArray.slice(take)
    };
  }

  // guillotine for mixed SKUs
  const free = [{ x:0, y:0, w:PALLET_L, h:PALLET_W }];
  const placed = [];
  let notPlaced = boxArray.slice();

  boxArray.forEach(inst => {
    let fit = null;
    const opts = [{l:inst.dims.l, w:inst.dims.w}];
    if (inst.canRotate) opts.push({l:inst.dims.w, w:inst.dims.l});

    for (const r of free) {
      for (const d of opts) {
        if (d.l <= r.w && d.w <= r.h) { fit={rect:r,dims:d}; break; }
      }
      if (fit) break;
    }
    if (!fit) return;
    placed.push({ box: inst, x: fit.rect.x, y: fit.rect.y, dims: fit.dims });
    free.splice(free.indexOf(fit.rect), 1);
    free.push(
      { x: fit.rect.x + fit.dims.l, y: fit.rect.y,        w: fit.rect.w - fit.dims.l, h: fit.dims.w },
      { x: fit.rect.x,             y: fit.rect.y + fit.dims.w, w: fit.rect.w,               h: fit.rect.h - fit.dims.w }
    );
    notPlaced = notPlaced.filter(i => i !== inst);
  });

  return { placed, notPlaced };
}
