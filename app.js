// app.js

// Pallet constraints
const PALLET_LENGTH = 120;
const PALLET_WIDTH  = 80;
const PALLET_MAX_HEIGHT = 170;
const PALLET_MAX_GROSS_WEIGHT = 600; // includes 25kg pallet
const PALLET_WEIGHT = 25;            // wood alone

let products = {};

// Load detailed product data
window.addEventListener('DOMContentLoaded', async () => {
  const resp = await fetch(`products-detail.json?cb=${Date.now()}`);
  products = await resp.json();
});

document.getElementById('go').addEventListener('click', async () => {
  // 1) Read order
  const customer = document.getElementById('customer').value.trim();
  const fileInput = document.getElementById('fileInput');
  if (!customer || !fileInput.files.length) {
    return alert('Please enter customer and select .xlsx');
  }
  const data = await fileInput.files[0].arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header:1, range:3 });

  // 2) Build box-instances list
  const instances = [];
  rows.filter(r=> r[2] && r[2].toString().toUpperCase()!=='REF')
      .forEach(r => {
    const sku   = r[2].toString().trim();
    const boxKey= r[4].toString().trim().toLowerCase(); // "box1"/"box2"
    const units = Number(r[5]) || 0;
    const pd    = products[sku];
    if (!pd) return;
    const boxP  = pd[boxKey];
    if (!boxP || !boxP.units) return;
    const count = Math.ceil(units / boxP.units);
    // for each box instance...
    for(let i=0; i<count; i++){
      // parse dims [L,D,H]
      const [L,D,H] = boxP.dimensions;
      // orientation
      const canBoth = boxP.orientation.toLowerCase()==='both';
      instances.push({
        sku,
        name: pd.name||sku,
        fragility: pd.fragility.toLowerCase(),   // "fragile"/"medium"/"strong"
        weight: boxP.weight,
        dims: { l: L, w: D, h: H },
        orientation: boxP.orientation.toLowerCase(), // "horizontal" or "both"
        canRotate: canBoth
      });
    }
  });

  // 3) Sort by fragility (strong → medium → fragile)
  const orderMap = { strong:0, medium:1, fragile:2 };
  instances.sort((a,b)=> orderMap[a.fragility] - orderMap[b.fragility]);

  // 4) Pack into pallets
  const pallets = [];
  let remaining = instances.slice();
  while(remaining.length){
    // start new pallet
    let usedHeight = 0;
    let usedWeight = PALLET_WEIGHT;
    const pallet = { layers: [] };
    while(remaining.length){
      // attempt next layer
      const layerRes = packLayer(remaining);
      if (!layerRes.placed.length) break; // no fit → done with this pallet

      const layerHeight = Math.max(...layerRes.placed.map(b=>b.box.dims.h));
      const layerWeight = layerRes.placed.reduce((s,b)=>s + b.box.weight, 0);
      // check height & weight
      if (usedHeight + layerHeight > PALLET_MAX_HEIGHT) break;
      if (usedWeight + layerWeight > PALLET_MAX_GROSS_WEIGHT) break;

      // commit layer
      pallet.layers.push({
        boxes: layerRes.placed,
        height: layerHeight,
        weight: layerWeight
      });
      usedHeight += layerHeight;
      usedWeight += layerWeight;
      // remove placed from remaining
      remaining = layerRes.remaining;
    }
    pallets.push(pallet);
  }

  // 5) Render output
  renderPallets(pallets);
});

// Guillotine‐style pack one layer
function packLayer(boxes){
  const freeRects = [{ x:0,y:0,w:PALLET_LENGTH,h:PALLET_WIDTH }];
  const placed    = [];
  const remaining = boxes.slice();

  for(let i=0; i<boxes.length; i++){
    const box = boxes[i];
    // choose orientation dims
    const dimsList = [{l:box.dims.l, w:box.dims.w}];
    if(box.canRotate){
      dimsList.push({l:box.dims.w, w:box.dims.l});
    }
    let fit = null;
    // search free rect
    for(const rect of freeRects){
      for(const d of dimsList){
        if(d.l<=rect.w && d.w<=rect.h){
          fit = {rect,d};
          break;
        }
      }
      if(fit) break;
    }
    if(!fit) continue; // no place

    // place it
    const {rect,d} = fit;
    placed.push({box, x:rect.x, y:rect.y, dims:d});

    // remove this rect
    freeRects.splice(freeRects.indexOf(rect),1);
    // split into two
    freeRects.push(
      { x:rect.x+d.l, y:rect.y, w:rect.w-d.l, h:d.w },
      { x:rect.x, y:rect.y+d.w, w:rect.w,   h:rect.h-d.w }
    );
    // remove box from remaining
    const idx = remaining.indexOf(box);
    if(idx>=0) remaining.splice(idx,1);
  }
  return {placed, remaining};
}

// Render pallets & layers to HTML
function renderPallets(pallets){
  let html = '';
  let pIdx = 1, totalBoxes=0, totalUnits=0;
  for(const p of pallets){
    html += `<h2>PALLET ${pIdx}</h2>`;
    let layerIdx=1;
    for(const layer of p.layers){
      html += `<h3>Layer ${layerIdx} (H:${layer.height}cm, Wt:${layer.weight.toFixed(1)}kg)</h3>`;
      // group counts by SKU
      const cnt = {};
      layer.boxes.forEach(b=>{
        cnt[b.box.sku] = (cnt[b.box.sku]||0)+1;
      });
      html += `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;">
        <thead><tr><th>SKU</th><th>Product</th><th>#Boxes</th></tr></thead><tbody>`;
      Object.entries(cnt).forEach(([sku,n])=>{
        const name = products[sku].name || sku;
        html += `<tr><td>${sku}</td><td>${name}</td><td style="text-align:right;">${n}</td></tr>`;
        totalBoxes += n;
        totalUnits += (products[sku][layer.boxKey].units || 0)*n;
      });
      html += `</tbody></table>`;
      layerIdx++;
    }
    pIdx++;
  }
  html += `<h3>TOTAL: ${pallets.length} pallets | ${totalBoxes} boxes</h3>`;
  document.getElementById('output').innerHTML = html;
}
