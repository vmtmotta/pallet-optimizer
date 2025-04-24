// app.js

// Pallet constraints
const PALLET_L = 120, PALLET_W = 80;
const MAX_H    = 170, MAX_WT   = 600, PALLET_WT = 25;

let products = {};
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const resp = await fetch(`products-detail.json?cb=${Date.now()}`);
    products = await resp.json();
  } catch (e) {
    console.error('Failed loading product data', e);
    alert('Could not load master data');
  }
});

document.getElementById('go').addEventListener('click', async () => {
  const customer = document.getElementById('customer').value.trim();
  const fileInput= document.getElementById('fileInput');
  if (!customer || !fileInput.files.length) {
    return alert('Enter customer & select an Excel file');
  }

  // 1) Read workbook + first sheet
  const buf = await fileInput.files[0].arrayBuffer();
  const wb  = XLSX.read(buf, {type:'array'});
  const ws  = wb.Sheets[wb.SheetNames[0]];

  // 2) Get ALL rows as arrays
  const rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, blankrows:false});
  // 3) Find header row
  const headerLabels = ['REF','PRODUCT','BOX USED (BOX1 OR BOX2)','ORDER IN UNITS'];
  let h = rows.findIndex(r => {
    const up = r.map(c=> c?.toString().toUpperCase().trim());
    return headerLabels.every(lbl => up.includes(lbl));
  });
  if (h < 0) {
    return alert('Could not find header row (REF / PRODUCT / BOX USED / ORDER IN UNITS).');
  }
  // locate each column index
  const hdr = rows[h].map(c=>c.toString().toUpperCase().trim());
  const ci = {
    REF : hdr.indexOf('REF'),
    PROD: hdr.indexOf('PRODUCT'),
    BOX : hdr.indexOf('BOX USED (BOX1 OR BOX2)'),
    UNITS:hdr.indexOf('ORDER IN UNITS')
  };

  // 4) Build order lines until blank REF
  const orders = [];
  for (let i = h+1; i < rows.length; i++) {
    const r = rows[i];
    const sku = r[ci.REF]?.toString().trim();
    if (!sku) break;  // stop on blank
    orders.push({
      sku,
      name: r[ci.PROD]?.toString().trim()||sku,
      boxKey: r[ci.BOX]?.toString().trim().toLowerCase(),
      units: Number(r[ci.UNITS])||0
    });
  }
  if (!orders.length) {
    return document.getElementById('output')
      .innerHTML = '<p><em>No valid order lines found. Check your file.</em></p>';
  }

  // 5) Expand into box‐instances
  let instances = [];
  orders.forEach(o => {
    const pd = products[o.sku];
    if (!pd) return console.warn('No master data for',o.sku);
    const boxSpec = pd[o.boxKey];
    if (!boxSpec || !boxSpec.units) return console.warn('Missing box spec for',o.sku);
    const count = Math.ceil(o.units/boxSpec.units);
    for (let k=0;k<count;k++){
      const [L,D,H] = boxSpec.dimensions;
      instances.push({
        sku:o.sku, name:o.name,
        fragility:pd.fragility.toLowerCase(),
        weight:boxSpec.weight, dims:{l:L,w:D,h:H},
        canRotate: boxSpec.orientation.toLowerCase()==='both'
      });
    }
  });

  if (!instances.length) {
    return document.getElementById('output')
      .innerHTML = '<p><em>No boxes to pack after expansion.</em></p>';
  }

  // 6) Sort by fragility
  const orderFrag = {strong:0,medium:1,fragile:2};
  instances.sort((a,b)=>orderFrag[a.fragility]-orderFrag[b.fragility]);

  // 7) Pack into pallets
  let rem = instances.slice(), pallets=[];
  while (rem.length) {
    let usedH = 0, usedWT = PALLET_WT;
    const pal={layers:[]};
    while (rem.length) {
      const {placed,notPlaced} = packLayer(rem);
      if (!placed.length) break;
      const layerH = Math.max(...placed.map(x=>x.box.dims.h));
      const layerWT= placed.reduce((s,x)=>s+x.box.weight,0);
      if (usedH+layerH>MAX_H||usedWT+layerWT>MAX_WT) break;
      pal.layers.push({boxes:placed,height:layerH,weight:layerWT});
      usedH+=layerH; usedWT+=layerWT;
      rem = notPlaced;
    }
    pallets.push(pal);
  }

  // 8) Render
  let out=`<h1>${customer}</h1>`;
  let totalBoxes=0,totalUnits=0,totalWT=0;
  pallets.forEach((p,i)=>{
    out+=`<h2>PALLET ${i+1}</h2>`;
    let pUnits=0,pBoxes=0,pWT=PALLET_WT,pH=0;
    p.layers.forEach((ly,li)=>{
      out+=`<h3>LAYER${li+1}</h3>
        <table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;">
        <thead><tr><th>SKU</th><th>Product</th><th>Units</th><th>Box Type</th><th>Boxes Needed</th></tr></thead><tbody>`;
      const cnt={};
      ly.boxes.forEach(b=>cnt[b.box.sku]=(cnt[b.box.sku]||0)+1);
      for (let [sku,n] of Object.entries(cnt)) {
        const od = orders.find(x=>x.sku===sku);
        const perB = products[sku][od.boxKey].units;
        const units = perB * n;
        out+=`<tr>
          <td>${sku}</td>
          <td>${od.name}</td>
          <td style="text-align:right">${units}</td>
          <td>${od.boxKey.toUpperCase()}</td>
          <td style="text-align:right">${n}</td>
        </tr>`;
        pUnits+=units; pBoxes+=n;
      }
      pWT += ly.weight; pH += ly.height;
      out+=`</tbody></table>`;
    });
    out+=`<p><strong>Summary pallet ${i+1}:</strong> 
      ${pUnits} units | ${pBoxes} Boxes | 
      Total Weight: ${pWT.toFixed(1)} Kg | 
      Total Height: ${pH} cm</p>`;
    totalBoxes+=pBoxes; totalUnits+=pUnits; totalWT+=pWT;
  });
  out+=`<h2>ORDER RESUME:</h2>
    <p>Total Pallets: ${pallets.length}<br>
       Total Weight: ${totalWT.toFixed(1)} Kg</p>`;
  document.getElementById('output').innerHTML = out;
});

// Guillotine pack
function packLayer(boxes) {
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
    const idx = notPlaced.indexOf(b);
    if (idx>=0) notPlaced.splice(idx,1);
  });
  return {placed, notPlaced};
}
