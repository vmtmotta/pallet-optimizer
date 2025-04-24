// app.js

// Pallet constraints
const PALLET_LENGTH    = 120;   // cm
const PALLET_WIDTH     =  80;   // cm
const PALLET_MAX_H     = 170;   // cm total stack height
const PALLET_MAX_WT    = 600;   // kg total gross (includes pallet)
const PALLET_WEIGHT    =  25;   // kg empty pallet

let products = {};

// 1) Load master-data JSON
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const resp = await fetch(`products-detail.json?cb=${Date.now()}`);
    products = await resp.json();
    console.log(`Loaded ${Object.keys(products).length} SKUs`);
  } catch (e) {
    console.error('Error loading products-detail.json', e);
    alert('Could not load product master data.');
  }
});

// 2) Hook up “Upload & Optimize”
document.getElementById('go').addEventListener('click', async () => {
  const customer = document.getElementById('customer').value.trim();
  const fileInput = document.getElementById('fileInput');
  if (!customer || !fileInput.files.length) {
    return alert('Please enter Customer and select an order .xlsx file.');
  }

  // 3) Read workbook
  const buf = await fileInput.files[0].arrayBuffer();
  const wb  = XLSX.read(buf, { type:'array' });
  const sheet = wb.SheetNames[0];
  console.log('Using sheet:', sheet);
  const ws = wb.Sheets[sheet];

  // 4) Scan first 10 rows to find header row index
  const raw = XLSX.utils.sheet_to_json(ws, { header:1, range:0, blankrows:false });
  let headerRow = -1, idxREF, idxPROD, idxBOX, idxUNITS;
  for (let i = 0; i < Math.min(raw.length,10); i++) {
    const row = raw[i].map(c=>c && c.toString().toUpperCase().trim());
    if (row.includes('REF') && row.includes('PRODUCT') && row.includes('BOX USED (BOX1 OR BOX2)') && row.includes('ORDER IN UNITS')) {
      headerRow = i;
      idxREF   = row.indexOf('REF');
      idxPROD  = row.indexOf('PRODUCT');
      idxBOX   = row.indexOf('BOX USED (BOX1 OR BOX2)');
      idxUNITS = row.indexOf('ORDER IN UNITS');
      break;
    }
  }
  if (headerRow < 0) {
    return alert('Could not find header row with REF / PRODUCT / BOX USED / ORDER IN UNITS.');
  }
  console.log(`Header row at ${headerRow}: cols REF=${idxREF}, PROD=${idxPROD}, BOX=${idxBOX}, UNITS=${idxUNITS}`);

  // 5) Read data rows starting below headerRow
  const data = XLSX.utils.sheet_to_json(ws, { header:1, range: headerRow + 2 });
  // 6) Stop at first empty REF
  const orders = [];
  for (let r of data) {
    const sku = r[idxREF]?.toString().trim();
    if (!sku) break;
    orders.push({
      sku,
      name:   r[idxPROD]?.toString().trim() || sku,
      boxKey: r[idxBOX]?.toString().trim().toLowerCase(),   // expects “box1” or “box2”
      units:  Number(r[idxUNITS]) || 0
    });
  }
  console.log(`Parsed ${orders.length} order lines`);

  // 7) Expand to individual box instances
  let instances = [];
  for (let {sku,name,boxKey,units} of orders) {
    const pd = products[sku];
    if (!pd) {
      console.warn(`No master data for ${sku}`); 
      continue;
    }
    const boxP = pd[boxKey];
    if (!boxP || !boxP.units) {
      console.warn(`Missing box data for ${sku}→${boxKey}`);
      continue;
    }
    const count = Math.ceil(units/boxP.units);
    for (let i=0; i<count; i++){
      const [L,D,H] = boxP.dimensions;
      instances.push({
        sku,name,
        fragility: pd.fragility.toLowerCase(),
        weight:    boxP.weight,
        dims:      {l:L,w:D,h:H},
        canRotate: boxP.orientation.toLowerCase()==='both',
        orient:    boxP.orientation.toLowerCase()
      });
    }
  }
  if (!instances.length) {
    return document.getElementById('output').innerHTML =
      `<p><em>No boxes to pack. Check your order file.</em></p>`;
  }
  console.log(`Built ${instances.length} box instances`);

  // 8) Sort by fragility (strong→medium→fragile)
  const orderFrag = {'strong':0,'medium':1,'fragile':2};
  instances.sort((a,b)=>orderFrag[a.fragility]-orderFrag[b.fragility]);

  // 9) Pack instances into pallets
  let remaining = instances.slice(), pallets = [];
  while (remaining.length) {
    let usedH = 0, usedW = PALLET_WEIGHT;
    const pallet = { layers: [] };

    while (remaining.length) {
      const {placed,notPlaced} = packLayer(remaining);
      if (!placed.length) break;
      const layerH = Math.max(...placed.map(x=>x.box.dims.h));
      const layerW = placed.reduce((s,x)=>s + x.box.weight, 0);
      if (usedH+layerH>PALLET_MAX_H || usedW+layerW>PALLET_MAX_WT) break;
      pallet.layers.push({boxes:placed,height:layerH,weight:layerW});
      usedH+=layerH; usedW+=layerW;
      remaining = notPlaced;
    }
    pallets.push(pallet);
  }

  // 10) Render in your required layout
  let out=`<h1>${customer}</h1>`;
  let totalBoxes=0, totalUnits=0, totalWeight=0;
  pallets.forEach((p,pi)=>{
    out+=`<h2>PALLET ${pi+1}</h2>
          <table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;">
            <thead><tr><th>SKU</th><th>Product</th><th>Units</th><th>Box Type</th><th>Boxes Needed</th></tr></thead><tbody>`;
    let palletUnits=0, palletBoxes=0, palletWt=PALLET_WEIGHT, palletHt=0;
    p.layers.forEach((ly,li)=>{
      out+=`<tr><td colspan="5"><strong>LAYER ${li+1}</strong></td></tr>`;
      // count per row
      const cnt={};
      ly.boxes.forEach(b=>cnt[b.box.sku]=(cnt[b.box.sku]||0)+1);
      for (let [sku,n] of Object.entries(cnt)){
        const pd = orders.find(o=>o.sku===sku);
        const unitsPerBox = products[sku][pd.boxKey].units;
        const units = unitsPerBox * n;
        out+=`<tr>
                <td>${sku}</td>
                <td>${pd.name}</td>
                <td style="text-align:right;">${units}</td>
                <td>${pd.boxKey.toUpperCase()}</td>
                <td style="text-align:right;">${n}</td>
              </tr>`;
        palletUnits+=units;
        palletBoxes+=n;
        totalUnits+=units;
        totalBoxes+=n;
      }
      palletWt += ly.weight;
      palletHt += ly.height;
    });
    out+=`</tbody></table>
          <p><strong>Summary pallet ${pi+1}:</strong>
             ${palletUnits} units | ${palletBoxes} Boxes | 
             Total Weight: ${palletWt.toFixed(1)} Kg | 
             Total Height: ${palletHt} cm</p>`;
    totalWeight+=palletWt;
  });
  out+=`<h2>ORDER RESUME:</h2>
        <p>Total Pallets: ${pallets.length}<br>
           Total Weight: ${totalWeight.toFixed(1)} Kg</p>`;

  document.getElementById('output').innerHTML = out;
});

// Guillotine‐style 2D packing for one layer
function packLayer(boxes){
  const free=[{x:0,y:0,w:PALLET_LENGTH,h:PALLET_WIDTH}];
  const placed=[], notPlaced=boxes.slice();
  boxes.forEach(b=>{
    let fit=null;
    const options=[{l:b.dims.l,w:b.dims.w}];
    if (b.canRotate) options.push({l:b.dims.w,w:b.dims.l});
    for (let r of free){
      for (let d of options){
        if (d.l<=r.w && d.w<=r.h){ fit={rect:r,d}; break; }
      }
      if (fit) break;
    }
    if (!fit) return;
    placed.push({box:b, x:fit.rect.x, y:fit.rect.y, dims:fit.d});
    free.splice(free.indexOf(fit.rect),1);
    free.push(
      {x:fit.rect.x+fit.d.l, y:fit.rect.y,      w:fit.rect.w-fit.d.l, h:fit.d.w},
      {x:fit.rect.x,        y:fit.rect.y+fit.d.w, w:fit.rect.w,        h:fit.rect.h-fit.d.w}
    );
    const idx=notPlaced.indexOf(b);
    if (idx>=0) notPlaced.splice(idx,1);
  });
  return {placed, notPlaced};
}
