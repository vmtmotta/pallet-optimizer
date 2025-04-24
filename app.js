// app.js

// ── 1) Pallet constraints ───────────────────────────────────────────────────────
const PALLET_L        = 120;  // cm
const PALLET_W        =  80;  // cm
const PALLET_MAX_H    = 170;  // cm
const PALLET_EMPTY_WT =  25;  // kg

// ── 2) Master‐data lookup ───────────────────────────────────────────────────────
let productsBySku = {};

// ── Utility: parse "LxDxH" ─────────────────────────────────────────────────────
function parseDims(str = "0x0x0") {
  const [l,w,h] = str.split(/[x×]/i).map(Number);
  return { l, w, h };
}

// ── 3) Load products‐detail.json with dynamic SKU field detection ───────────────
window.addEventListener('DOMContentLoaded', async () => {
  console.log("Loading products‐detail.json…");
  try {
    const resp = await fetch('products-detail.json');
    const raw  = await resp.json();
    console.log("Raw JSON:", raw);

    // Normalize to array
    let list;
    if (Array.isArray(raw)) {
      list = raw;
    } else {
      // maybe { Sheet1: [ … ] }
      const keys = Object.keys(raw);
      if (keys.length === 1 && Array.isArray(raw[keys[0]])) {
        list = raw[keys[0]];
      } else {
        list = Object.values(raw);
      }
    }
    console.log("Normalized list (first rec):", list[0]);

    // Detect which field holds the SKU key:
    const rec0 = list[0];
    let skuKey = null;
    if (rec0.hasOwnProperty("REF")) {
      skuKey = "REF";
    } else if (rec0.hasOwnProperty("sku")) {
      skuKey = "sku";
    } else {
      throw new Error("Cannot find REF or sku field in master‐data");
    }

    // Detect product name field:
    let nameKey = rec0.hasOwnProperty("PRODUCT") ? "PRODUCT"
                : rec0.hasOwnProperty("product") ? "product"
                : null;
    if (!nameKey) throw new Error("Cannot find PRODUCT field in master‐data");

    // Build lookup
    list.forEach(p => {
      const key = p[skuKey].toString().trim();
      productsBySku[key] = {
        name:      p[nameKey],
        // Box1
        box1Units:  Number(p["Box 1 Units"])       || 0,
        box1Weight: Number(p["Box 1 Weight (kg)"]) || 0,
        box1Orient: (p["Box 1 Orientation (Horizontal / Both)"]||"").toLowerCase(),
        box1Dims:   parseDims(p["Box 1 Dimensions (cm) (LxDxH)"]),
        // Box2
        box2Units:  Number(p["Box 2 Units"])       || 0,
        box2Weight: Number(p["Box 2 Weight (kg)"]) || 0,
        box2Orient: (p["Box 2 Orientation (Horizontal / Both)"]||"").toLowerCase(),
        box2Dims:   parseDims(p["Box 2 Dimensions (cm) (LxDxH)"])
      };
    });

    console.log("productsBySku keys loaded:", Object.keys(productsBySku).slice(0,10));
  } catch (err) {
    console.error("Error loading master data:", err);
    alert("Failed to load products-detail.json—see console for details.");
  }
});

// ── 4) Read the order file ───────────────────────────────────────────────────────
function readOrderFile(file) {
  return new Promise((resolve,reject) => {
    const fr = new FileReader();
    fr.onload = e => {
      try {
        const wb    = XLSX.read(e.target.result, {type:"binary"});
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const arr   = XLSX.utils.sheet_to_json(sheet, {defval:""});
        console.log("Order XLSX rows:", arr);

        const lines = arr.map(r => ({
          sku:    r["REF"].toString().trim(),
          boxKey: r["BOX USED (BOX1 or BOX2)"].toString().trim().toLowerCase(),
          units:  Number(r["ORDER IN UNITS"]) || 0
        })).filter(r=>r.sku);

        console.log("Parsed order lines:", lines);
        resolve(lines);
      } catch (err) {
        reject(err);
      }
    };
    fr.onerror = ()=>reject(fr.error);
    fr.readAsBinaryString(file);
  });
}

// ── 5) 5+2 grid count helper ─────────────────────────────────────────────────────
function bestSingleGridCount(d, canRotate) {
  const L=PALLET_L, W=PALLET_W;
  let best=0;
  const opts=[{l:d.l,w:d.w}];
  if(canRotate) opts.push({l:d.w,w:d.l});
  opts.forEach((o1,i1)=>{
    const rows=Math.floor(L/o1.l), cols=Math.floor(W/o1.w);
    const base=rows*cols;
    const remL=L-rows*o1.l, remW=W-cols*o1.w;
    let extra=0;
    opts.forEach((o2,i2)=>{
      if(i1===i2) return;
      const c1=Math.floor(remL/o2.l)*Math.floor(W/o2.w),
            c2=Math.floor(L/o2.l)*Math.floor(remW/o2.w);
      extra=Math.max(extra,c1+c2);
    });
    best=Math.max(best, base+extra);
  });
  return best;
}

// ── 6) Pack one layer ───────────────────────────────────────────────────────────
function packLayer(insts) {
  if(!insts.length) return {placed:[],notPlaced:[]};

  // single SKU?
  const sku0 = insts[0].sku;
  if(insts.every(x=>x.sku===sku0)) {
    const pd     = productsBySku[sku0];
    const dims   = pd[insts[0].boxKey+"Dims"];
    const canR   = pd[insts[0].boxKey+"Orient"]==="both";
    const maxCnt = bestSingleGridCount(dims,canR);
    const take   = Math.min(maxCnt, insts.length);
    return {
      placed: insts.slice(0,take).map(b=>({box:b})),
      notPlaced: insts.slice(take)
    };
  }

  // mixed SKU: guillotine
  let free=[{x:0,y:0,w:PALLET_L,h:PALLET_W}], rem=[...insts], placed=[];
  insts.forEach(inst=>{
    const pd   = productsBySku[inst.sku];
    const dims = pd[inst.boxKey+"Dims"];
    const canR = pd[inst.boxKey+"Orient"]==="both";
    const opts=[{l:dims.l,w:dims.w}];
    if(canR) opts.push({l:dims.w,w:dims.l});
    let slot=null,d=null;
    outer: for(let r of free){
      for(let o of opts){
        if(o.l<=r.w&&o.w<=r.h){ slot=r; d=o; break outer; }
      }
    }
    if(!slot) return;
    placed.push({box:inst,dims:d});
    rem=rem.filter(x=>x!==inst);
    free=free.filter(r=>r!==slot);
    free.push(
      {x:slot.x+d.l,y:slot.y,       w:slot.w-d.l,h:d.w},
      {x:slot.x,y:slot.y+d.w,       w:slot.w,    h:slot.h-d.w}
    );
  });
  return {placed,notPlaced:rem};
}

// ── 7) Main optimize ────────────────────────────────────────────────────────────
async function optimize() {
  console.clear();
  const cust = document.getElementById("customer").value.trim();
  if(!cust) { alert("Enter customer"); return; }

  const fi = document.getElementById("fileInput");
  if(!fi.files.length) { alert("Select file"); return; }

  // read order
  let lines;
  try { lines = await readOrderFile(fi.files[0]); }
  catch(e) { alert("Order read error: "+e.message); console.error(e); return; }
  console.log("Order lines:", lines);

  // check missing SKUs
  const missing = lines.filter(l=>!(l.sku in productsBySku)).map(l=>l.sku);
  if(missing.length) {
    alert("Missing SKUs in master-data:\n"+[...new Set(missing)].join(", "));
    console.warn("Missing SKUs:", missing);
    // STOP here so you can fix JSON
    return;
  }

  // expand to box instances
  let insts = [];
  lines.forEach(l=>{
    const pd = productsBySku[l.sku];
    const cap = pd[l.boxKey+"Units"];
    const cnt = Math.ceil(l.units/cap);
    for(let i=0;i<cnt;i++){
      insts.push({
        sku:      l.sku,
        name:     pd.name,
        boxKey:   l.boxKey,
        weight:   pd[l.boxKey+"Weight"],
        dims:     pd[l.boxKey+"Dims"],
        canRotate: pd[l.boxKey+"Orient"]==="both"
      });
    }
  });
  console.log("Expanded instances:", insts);
  if(!insts.length){
    document.getElementById("results").innerHTML = "<p><em>No boxes after expansion.</em></p>";
    return;
  }

  // pack into pallets...
  let rem=[...insts], pallets=[];
  while(rem.length){
    let usedH=0, wt=PALLET_EMPTY_WT, layers=[];
    while(true){
      const {placed,notPlaced}=packLayer(rem);
      if(!placed.length) break;
      const h=Math.max(...placed.map(x=>x.box.dims.h));
      if(usedH+h>PALLET_MAX_H) break;
      usedH+=h; wt+=placed.reduce((s,x)=>s+x.box.weight,0);
      layers.push(placed); rem=notPlaced;
    }
    pallets.push({layers,height:usedH,weight:wt});
  }
  console.log("Pallets:", pallets);

  // render your table here...
  document.getElementById("results").innerHTML = "<p>Packing complete. See console for pallet data.</p>";
}

// ── 8) Wire up ─────────────────────────────────────────────────────────────────
document.getElementById("go").addEventListener("click", optimize);
