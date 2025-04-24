// app.js

// Pallet constants
const PALLET_L = 120,  // cm
      PALLET_W =  80,  // cm
      MAX_H    = 170,  // cm total stack height
      MAX_WT   = 600,  // kg including pallet
      PALLET_WT=  25;  // kg empty

let products = {};

// 1) Load product master data
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const resp = await fetch(`products-detail.json?cb=${Date.now()}`);
    products = await resp.json();
  } catch (e) {
    console.error(e);
    alert('Error loading product data');
  }
});

document.getElementById('go').addEventListener('click', async () => {
  const customer = document.getElementById('customer').value.trim();
  const fileInput = document.getElementById('fileInput');
  if (!customer || !fileInput.files.length) {
    return alert('Enter customer name & pick an Excel file');
  }

  // 2) Read the uploaded workbook & first sheet
  const buf = await fileInput.files[0].arrayBuffer();
  const wb  = XLSX.read(buf, { type:'array' });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  // 3) Build array of row‐objects, skipping row 0 (the calibration row)
  //    row 1 becomes the header
  const orders = XLSX.utils.sheet_to_json(ws, {
    range: 1,
    defval: ''    // fill missing cells with ''
  });

  // 4) Stop at first blank REF
  const cleanOrders = [];
  for (let row of orders) {
    if (!row.REF) break;
    cleanOrders.push({
      sku:    row.REF.toString().trim(),
      name:   row.PRODUCT.toString().trim(),
      boxKey: row['BOX USED (BOX1 or BOX2)'].toString().trim().toLowerCase(),  // "box1" or "box2"
      units:  Number(row['ORDER IN UNITS']) || 0
    });
  }

  if (!cleanOrders.length) {
    return document.getElementById('output').innerHTML =
      '<p><em>No valid order lines found. Check your file.</em></p>';
  }

  // 5) Expand to individual boxes
  let instances = [];
  for (let {sku,name,boxKey,units} of cleanOrders) {
    const pd = products[sku];
    if (!pd) {
      console.warn(`No master data for SKU ${sku}`);
      continue;
    }
    const boxSpec = pd[boxKey];
    if (!boxSpec || !boxSpec.units) {
      console.warn(`Missing boxSpec for ${sku}→${boxKey}`);
      continue;
    }
    const count = Math.ceil(units / boxSpec.units);
    for (let i = 0; i < count; i++) {
      const [L, D, H] = boxSpec.dimensions;
      instances.push({
        sku, name,
        fragility: pd.fragility.toLowerCase(),
        weight:    boxSpec.weight,
        dims:      {l:L, w:D, h:H},
        canRotate: boxSpec.orientation.toLowerCase()==='both'
      });
    }
  }

  if (!instances.length) {
    return document.getElementById('output').innerHTML =
      '<p><em>No boxes to pack after expansion. Check your master data & order file.</em></p>';
  }

  // 6) Sort by fragility (strong→medium→fragile)
  const fragOrder = {strong:0, medium:1, fragile:2};
  instances.sort((a,b)=> fragOrder[a.fragility] - fragOrder[b.fragility]);

  // 7) Guillotine‐pack into pallets
  let remaining = instances.slice(), pallets = [];
  while (remaining.length) {
    let usedH = 0, usedWT = PALLET_WT;
    const pallet = {layers:[]};

    while (remaining.length) {
      const {placed, notPlaced} = packLayer(remaining);
      if (!placed.length) break;

      const layerH = Math.max(...placed.map(x=>x.box.dims.h));
      const layerWT = placed.reduce((s,x)=>s + x.box.weight, 0);

      if (usedH + layerH > MAX_H) break;
      if (usedWT + layerWT > MAX_WT) break;

      pallet.layers.push({boxes:placed, height:layerH, weight:layerWT});
      usedH  += layerH;
      usedWT += layerWT;
      remaining = notPlaced;
    }
    pallets.push(pallet);
  }

  // 8) Render output
  let html = `<h1>${customer}</h1>`;
  let orderTotalBoxes = 0, orderTotalUnits = 0, orderTotalWT = 0;

  pallets.forEach((p,pi) => {
    html += `<h2>PALLET ${pi+1}</h2>`;
    let palletUnits=0, palletBoxes=0, palletWT=PALLET_WT, palletH=0;

    p.layers.forEach((ly,li) => {
      html += `<h3>LAYER${li+1}</h3>
        <table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;">
          <thead><tr>
            <th>SKU</th><th>Product</th><th>Units</th><th>Box Type</th><th>Boxes Needed</th>
          </tr></thead><tbody>`;

      // count boxes by SKU
      const cnt = {};
      ly.boxes.forEach(b=>cnt[b.box.sku]=(cnt[b.box.sku]||0)+1);

      for (let [sku,n] of Object.entries(cnt)) {
        const orderLine = cleanOrders.find(o=>o.sku===sku);
        const perBox = products[sku][orderLine.boxKey].units;
        const units  = perBox * n;

        html += `<tr>
          <td>${sku}</td>
          <td>${orderLine.name}</td>
          <td style="text-align:right">${units}</td>
          <td>${orderLine.boxKey.toUpperCase()}</td>
          <td style="text-align:right">${n}</td>
        </tr>`;

        palletUnits += units;
        palletBoxes += n;
      }

      palletWT += ly.weight;
      palletH  += ly.height;
      orderTotalBoxes += palletBoxes;
      orderTotalUnits += palletUnits;

      html += `</tbody></table>`;
    });

    html += `<p><strong>Summary pallet ${pi+1}:</strong>
      ${palletUnits} units | ${palletBoxes} Boxes | 
      Total Weight: ${palletWT.toFixed(1)} Kg | 
      Total Height: ${palletH} cm</p>`;

    orderTotalWT += palletWT;
  });

  html += `<h2>ORDER RESUME:</h2>
    <p>Total Pallets: ${pallets.length}<br>
       Total Weight: ${orderTotalWT.toFixed(1)} Kg</p>`;

  document.getElementById('output').innerHTML = html;
});

// Guillotine‐style 2D pack for one layer
function packLayer(boxes){
  const free=[{x:0,y:0,w:PALLET_L,h:PALLET_W}], placed=[], notPlaced=boxes.slice();
  boxes.forEach(b=>{
    let fit=null;
    const opts=[{l:b.dims.l,w:b.dims.w}];
    if (b.canRotate) opts.push({l:b.dims.w,w:b.dims.l});
    for (let r of free){
      for (let d of opts){
        if (d.l<=r.w && d.w<=r.h){ fit={rect:r,d}; break; }
      }
      if (fit) break;
    }
    if (!fit) return;
    placed.push({box:b, x:fit.rect.x, y:fit.rect.y, dims:fit.d});
    free.splice(free.indexOf(fit.rect),1);
    free.push(
      {x:fit.rect.x+fit.d.l, y:fit.rect.y,       w:fit.rect.w-fit.d.l, h:fit.d.w},
      {x:fit.rect.x,        y:fit.rect.y+fit.d.w, w:fit.rect.w,         h:fit.rect.h-fit.d.w}
    );
    const idx=notPlaced.indexOf(b);
    if (idx>=0) notPlaced.splice(idx,1);
  });
  return {placed, notPlaced};
}
