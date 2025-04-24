// app.js

// you must have <script src="https://unpkg.com/xlsx/dist/xlsx.full.min.js"></script>
// before this script in your HTML.

// ---- configuration ----
const PALLET_L = 120;    // cm
const PALLET_W = 80;     // cm
const PALLET_H = 170;    // cm
const PALLET_WEIGHT = 25; // kg

// ---- globals ----
let productsBySku = {};

// ---- load product‐detail JSON ----
fetch('products-detail.json')
  .then(r => r.json())
  .then(arr => {
    arr.forEach(p => {
      // parse the dimensions string "LxWxH" into numbers
      const [l,w,h] = p['Box 2 Dimensions (cm) (LxDxH)']
        .split(/[x×]/i).map(x=>parseFloat(x));
      productsBySku[p.sku] = {
        name: p.Product,
        dims: { l, w, h },
        weight: parseFloat(p['Box 2 Weight (kg)']),
        canRotate: p['Box 2 Orientation (Horizontal / Both)'].toLowerCase() === 'both'
      };
      // if you also need BOX1 data, parse here similarly
    });
    document.getElementById('upload').disabled = false;
  })
  .catch(e => {
    console.error('Failed to load products-detail.json', e);
    alert('Cannot load product master data.');
  });

// ---- helper: parse order file ----
function readOrderFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type:'binary' });
        const sheet = wb.Sheets[ wb.SheetNames[0] ];
        const rows = XLSX.utils.sheet_to_json(sheet, { header:1 });
        // find header row
        const header = rows.find(r => r.includes('REF') && r.includes('BOX USED'));
        if (!header) throw new Error('Header row not found');
        const iREF = header.indexOf('REF');
        const iBOX = header.indexOf('BOX USED (BOX1 or BOX2)');
        const iQTY = header.indexOf('ORDER IN UNITS');
        const data = rows
          .slice(rows.indexOf(header)+1)
          .map(r => ({
            sku:     r[iREF],
            boxType: r[iBOX],
            qty:     parseInt(r[iQTY],10)||0
          }))
          .filter(x=>x.sku && x.boxType && x.qty>0);
        resolve(data);
      } catch(err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsBinaryString(file);
  });
}

// ---- grid‐count for one SKU in one layer ----
function bestSingleGridCount(dims, canRotate) {
  const Wp = PALLET_W, Lp = PALLET_L;
  let best = 0;
  const orients = [{l:dims.l,w:dims.w}];
  if (canRotate) orients.push({l:dims.w,w:dims.l});
  for (let o1 of orients) {
    // base grid
    const rows = Math.floor(Lp/o1.l);
    const cols = Math.floor(Wp/o1.w);
    const baseCount = rows * cols;
    const remL = Lp - rows*o1.l;
    const remW = Wp - cols*o1.w;
    // fill leftover strips with the other orientation
    let extra = 0;
    orients.forEach(o2 => {
      if (o2!==o1) {
        const c1 = Math.floor(remL/o2.l) * Math.floor(Wp/o2.w);
        const c2 = Math.floor(Lp/o2.l) * Math.floor(remW/o2.w);
        extra = Math.max(extra, c1 + c2);
      }
    });
    best = Math.max(best, baseCount + extra);
  }
  return best;
}

// ---- pack a single layer (either same‐SKU grid or mixed guillotine) ----
function packLayer(instances) {
  if (instances.length===0) return {placed:[],notPlaced:[]};
  // all same SKU?
  const sku0 = instances[0].sku;
  if (instances.every(x=>x.sku===sku0)) {
    const pd = productsBySku[sku0];
    const maxBoxes = bestSingleGridCount(pd.dims, pd.canRotate);
    const take = Math.min(maxBoxes, instances.length);
    return {
      placed: instances.slice(0,take).map(b=>({box:b})),
      notPlaced: instances.slice(take)
    };
  }
  // else mixed SKU => simple guillotine
  let free = [{x:0,y:0,w:PALLET_L,h:PALLET_W}];
  const placed = [];
  let remaining = [...instances];
  for (let inst of instances) {
    const pd = productsBySku[inst.sku];
    const tryOr = [{l:pd.dims.l,w:pd.dims.w}];
    if (pd.canRotate) tryOr.push({l:pd.dims.w,w:pd.dims.l});
    let slot = null, dim=null;
    outer: for (let r of free) {
      for (let o of tryOr) {
        if (o.l<=r.w && o.w<=r.h) {
          slot = r; dim = o;
          break outer;
        }
      }
    }
    if (!slot) continue;
    placed.push({box:inst,dims:dim});
    remaining = remaining.filter(x=>x!==inst);
    free = free.filter(r=>r!==slot);
    free.push(
      {x:slot.x+dim.l,y:slot.y,w:slot.w-dim.l,h:dim.w},
      {x:slot.x,y:slot.y+dim.w,w:slot.w,h:slot.h-dim.w}
    );
  }
  return {placed, notPlaced:remaining};
}

// ---- main optimize routine ----
async function optimize() {
  const fileIn = document.getElementById('file').files[0];
  if (!fileIn) return alert('Please choose an order file.');
  let orderLines;
  try {
    orderLines = await readOrderFile(fileIn);
  } catch(err) {
    return alert('Error reading order: '+err.message);
  }
  // expand to box‐instances
  const instances = [];
  for (let {sku,boxType,qty} of orderLines) {
    const pd = productsBySku[sku];
    if (!pd) continue;
    const cap = pd['boxType']==='BOX2'
      ? (Math.floor(PALLET_L/pd.dims.l)*Math.floor(PALLET_W/pd.dims.w))
      : 1; // placeholder if BOX1 differs
    const nBoxes = Math.ceil(qty/cap);
    for (let i=0;i<nBoxes;i++) {
      instances.push({sku, qty, pd});
    }
  }
  if (!instances.length) {
    return alert('No boxes to pack. Check your order file.');
  }

  const pallets = [];
  let rem = [...instances];
  while (rem.length) {
    const layers = [];
    let usedH = 0, totalW = 0;
    while (true) {
      const {placed,notPlaced} = packLayer(rem);
      if (!placed.length) break;
      const layerH = Math.max(...placed.map(p=>p.box.pd.dims.h));
      if (usedH + layerH > PALLET_H) break;
      usedH += layerH;
      totalW += placed.reduce((s,p)=>s + p.box.pd.weight, 0);
      layers.push(placed);
      rem = notPlaced;
    }
    pallets.push({layers, height:usedH, weight: totalW+PALLET_WEIGHT});
  }

  renderResults(pallets, orderLines);
}

// ---- render into the page ----
function renderResults(pallets, orderLines) {
  const out = document.getElementById('results');
  out.innerHTML = '';
  // for each pallet
  pallets.forEach((pal,i)=>{
    const div = document.createElement('div');
    div.innerHTML = `<h2>PALLET ${i+1}</h2>`;
    pal.layers.forEach((layer, li)=>{
      const tbl = document.createElement('table');
      tbl.innerHTML = `<tr><th colspan=5>LAYER ${li+1}</th></tr>
        <tr><th>SKU</th><th>Product</th><th>Units</th><th>Box Type</th><th>Boxes</th></tr>`;
      // count units per box in that layer
      const counts = {};
      layer.forEach(({box})=>{
        const key = box.sku;
        counts[key] = (counts[key]||0) + 1;
      });
      for (let [sku,n] of Object.entries(counts)) {
        const pd = productsBySku[sku];
        tbl.insertAdjacentHTML('beforeend',
          `<tr>
            <td>${sku}</td>
            <td>${pd.name}</td>
            <td>${n * /*units per box from master*/ ""}</td>
            <td>BOX2</td>
            <td>${n}</td>
          </tr>`);
      }
      div.appendChild(tbl);
    });
    div.insertAdjacentHTML('beforeend',
      `<p><strong>Summary pallet ${i+1}:</strong>
         ${pal.layers.flat().length} boxes |
         ${pal.weight.toFixed(1)} kg |
         ${pal.height} cm</p>`);
    out.appendChild(div);
  });

  // overall summary
  const totalBoxes = pallets.reduce((s,p)=>s + p.layers.flat().length, 0);
  const totalWeight = pallets.reduce((s,p)=>s + p.weight, 0);
  out.insertAdjacentHTML('beforeend',
    `<h3>ORDER RESUME:</h3>
     <p>Total pallets: ${pallets.length}<br>
        Total boxes: ${totalBoxes}<br>
        Total weight: ${totalWeight.toFixed(1)} kg</p>`);
}

// ---- hook upload button ----
document.getElementById('upload')
  .addEventListener('click', optimize);
