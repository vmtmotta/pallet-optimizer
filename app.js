// app.js

// Pallet specs
const PALLET_L = 120, PALLET_W = 80, PALLET_MAX_H = 170, PALLET_EMPTY_WT = 25;

let productsBySku = {};

// simple dim parser
function parseDims(s="0x0x0") {
  let [l,w,h] = s.split(/[x×]/i).map(Number);
  return { l,w,h };
}

// 1) load products-detail.json (top-level array of {REF,...})
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const resp = await fetch('products-detail.json');
    const list = await resp.json();
    list.forEach(p => {
      productsBySku[p.REF] = {
        name: p.PRODUCT,
        box1Units:   +p["Box 1 Units"]       || 0,
        box1Weight:  +p["Box 1 Weight (kg)"] || 0,
        box1Orient:  p["Box 1 Orientation (Horizontal / Both)"].toLowerCase(),
        box1Dims:    parseDims(p["Box 1 Dimensions (cm) (LxDxH)"]),
        box2Units:   +p["Box 2 Units"]       || 0,
        box2Weight:  +p["Box 2 Weight (kg)"] || 0,
        box2Orient:  p["Box 2 Orientation (Horizontal / Both)"].toLowerCase(),
        box2Dims:    parseDims(p["Box 2 Dimensions (cm) (LxDxH)"])
      };
    });
    console.log("Loaded SKUs:", Object.keys(productsBySku).length);
  } catch (e) {
    alert("Could not load products-detail.json");
    console.error(e);
  }
});

// 2) read .xlsx order
function readOrderFile(file) {
  return new Promise((res,rej) => {
    const fr = new FileReader();
    fr.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type:'binary' });
        const sh = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sh, { header:1, blankrows:false });
        const hdr  = rows.find(r =>
          r.includes("REF") &&
          r.includes("BOX USED (BOX1 or BOX2)") &&
          r.includes("ORDER IN UNITS")
        );
        const iREF = hdr.indexOf("REF");
        const iBOX = hdr.indexOf("BOX USED (BOX1 or BOX2)");
        const iUN  = hdr.indexOf("ORDER IN UNITS");
        const lines = [];
        for (let i = rows.indexOf(hdr)+1; i < rows.length; i++) {
          const r = rows[i];
          if (!r[iREF]) break;
          lines.push({
            sku:    r[iREF].toString().trim(),
            boxKey: r[iBOX].toString().trim().toLowerCase(),
            units:  +r[iUN]||0
          });
        }
        res(lines);
      } catch (err) {
        rej(err);
      }
    };
    fr.onerror = () => rej(fr.error);
    fr.readAsBinaryString(file);
  });
}

// 3) basic 5+2 grid solver
function bestSingleGridCount(d, canRotate) {
  let best=0, L=PALLET_L, W=PALLET_W;
  const opts = [{l:d.l,w:d.w}];
  if (canRotate) opts.push({l:d.w,w:d.l});
  opts.forEach((o1,i1)=>{
    const rows = Math.floor(L/o1.l), cols = Math.floor(W/o1.w);
    const base = rows*cols;
    const remL = L-rows*o1.l, remW = W-cols*o1.w;
    let extra=0;
    opts.forEach((o2,i2)=>{
      if (i1===i2) return;
      const c1 = Math.floor(remL/o2.l)*Math.floor(W/o2.w);
      const c2 = Math.floor(L/o2.l)*Math.floor(remW/o2.w);
      extra = Math.max(extra, c1+c2);
    });
    best = Math.max(best, base+extra);
  });
  return best;
}

// 4) pack one layer
function packLayer(insts) {
  if (!insts.length) return {placed:[],notPlaced:[]};
  const sku0 = insts[0].sku;
  if (insts.every(x=>x.sku===sku0)) {
    const pd = productsBySku[sku0];
    const dims = pd[insts[0].boxKey+"Dims"];
    const canR = pd[insts[0].boxKey+"Orient"]==="both";
    const maxCnt = bestSingleGridCount(dims,canR);
    const take = Math.min(maxCnt, insts.length);
    return {
      placed: insts.slice(0,take).map(b=>({box:b})),
      notPlaced: insts.slice(take)
    };
  }
  // mixed-SKU: simple guillotine
  let free=[{x:0,y:0,w:PALLET_L,h:PALLET_W}], placed=[], rem=[...insts];
  insts.forEach(inst=>{
    const pd = productsBySku[inst.sku];
    const dims = pd[inst.boxKey+"Dims"];
    const canR = pd[inst.boxKey+"Orient"]==="both";
    const opts=[{l:dims.l,w:dims.w}];
    if (canR) opts.push({l:dims.w,w:dims.l});
    let slot=null,d=null;
    outer: for (let r of free) {
      for (let o of opts) {
        if (o.l<=r.w && o.w<=r.h) { slot=r; d=o; break outer; }
      }
    }
    if (!slot) return;
    placed.push({box:inst,dims:d});
    rem = rem.filter(x=>x!==inst);
    free = free.filter(x=>x!==slot);
    free.push(
      {x:slot.x+d.l,y:slot.y,      w:slot.w-d.l,h:d.w},
      {x:slot.x,y:slot.y+d.w,      w:slot.w,    h:slot.h-d.w}
    );
  });
  return {placed,notPlaced:rem};
}

// 5) optimize and dump a simple text list
async function optimize(){
  const cust = document.getElementById("customer").value.trim();
  if (!cust) return alert("Enter customer");
  const fi = document.getElementById("fileInput");
  if (!fi.files.length) return alert("Select file");
  let lines;
  try { lines = await readOrderFile(fi.files[0]); }
  catch(e){ return alert("Read error: "+e.message); }
  if (!lines.length) {
    return document.getElementById("results").innerHTML = "<pre>No valid lines</pre>";
  }

  // expand
  let insts = [];
  lines.forEach(l=>{
    const pd = productsBySku[l.sku];
    if (!pd) return;
    const cap = pd[l.boxKey+"Units"];
    const cnt = Math.ceil(l.units/cap);
    for(let i=0;i<cnt;i++){
      insts.push({
        sku:l.sku,
        product:pd.name,
        boxKey:l.boxKey,
        weight:pd[l.boxKey+"Weight"],
        dims:pd[l.boxKey+"Dims"],
        canRotate:pd[l.boxKey+"Orient"]==="both"
      });
    }
  });
  if (!insts.length) {
    return document.getElementById("results").innerHTML =
      "<pre>No boxes after expansion.</pre>";
  }

  // pack only 1 pallet, 1 layer
  const {placed,notPlaced} = packLayer(insts);
  let out = `PALLET 1 → Layer 1:\n`;
  placed.forEach(b=>{
    out += `  ${b.box.sku} (${b.boxKey.toUpperCase()})\n`;
  });
  document.getElementById("results").innerHTML = `<pre>${out}</pre>`;
}

document.getElementById("go").addEventListener("click", optimize);
