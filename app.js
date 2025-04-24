// app.js

// ── 1) Pallet constraints ───────────────────────────────────────────────────────
const PALLET_L        = 120;  // cm
const PALLET_W        =  80;  // cm
const PALLET_MAX_H    = 170;  // cm
const PALLET_EMPTY_WT =  25;  // kg

// ── 2) Master-data lookup ───────────────────────────────────────────────────────
let productsBySku = {};

// ── Utility to parse "LxDxH" ─────────────────────────────────────────────────────
function parseDims(str="0x0x0") {
  const [l, w, h] = str.split(/[x×]/i).map(Number);
  return { l, w, h };
}

// ── 3) Load products-detail.json ────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  console.log("Loading master data…");
  try {
    const resp = await fetch('products-detail.json');
    const raw  = await resp.json();
    console.log("Raw JSON:", raw);

    // Normalize to array
    let list;
    if (Array.isArray(raw)) {
      list = raw;
    } else {
      const keys = Object.keys(raw);
      if (keys.length === 1 && Array.isArray(raw[keys[0]])) {
        list = raw[keys[0]];
      } else {
        list = Object.values(raw);
      }
    }
    console.log("Normalized list (first 3):", list.slice(0,3));

    // Build lookup
    list.forEach(p => {
      productsBySku[p.REF] = {
        name:      p.PRODUCT,
        box1Units:   Number(p["Box 1 Units"])       || 0,
        box1Weight:  Number(p["Box 1 Weight (kg)"]) || 0,
        box1Orient:  (p["Box 1 Orientation (Horizontal / Both)"]||'').toLowerCase(),
        box1Dims:    parseDims(p["Box 1 Dimensions (cm) (LxDxH)"]),

        box2Units:   Number(p["Box 2 Units"])       || 0,
        box2Weight:  Number(p["Box 2 Weight (kg)"]) || 0,
        box2Orient:  (p["Box 2 Orientation (Horizontal / Both)"]||'').toLowerCase(),
        box2Dims:    parseDims(p["Box 2 Dimensions (cm) (LxDxH)"])
      };
    });

    console.log("productsBySku keys:", Object.keys(productsBySku).slice(0,10));
  } catch (e) {
    console.error("Error loading products-detail.json:", e);
    alert("Failed to load master data; check console.");
  }
});

// ── 4) Read order file ───────────────────────────────────────────────────────────
function readOrderFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = e => {
      try {
        const wb    = XLSX.read(e.target.result, { type:'binary' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const arr   = XLSX.utils.sheet_to_json(sheet, { defval:"" });
        console.log("Excel rows:", arr);

        const lines = arr.map(row => ({
          sku:    row["REF"].toString().trim(),
          boxKey: row["BOX USED (BOX1 or BOX2)"].toString().trim().toLowerCase(),
          units:  Number(row["ORDER IN UNITS"]) || 0
        })).filter(r => r.sku);
        console.log("Parsed lines:", lines);
        resolve(lines);
      } catch (e) {
        reject(e);
      }
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsBinaryString(file);
  });
}

// ── 5) Grid helper ───────────────────────────────────────────────────────────────
function bestSingleGridCount(d, canRotate) {
  const L=PALLET_L, W=PALLET_W;
  let best=0, opts=[{l:d.l,w:d.w}];
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
    best=Math.max(best,base+extra);
  });
  return best;
}

// ── 6) Pack one layer ───────────────────────────────────────────────────────────
function packLayer(insts) {
  if(!insts.length) return {placed:[],notPlaced:[]};
  // single SKU?
  const sku0=insts[0].sku;
  if(insts.every(x=>x.sku===sku0)) {
    const pd=productsBySku[sku0], dims=pd[insts[0].boxKey+"Dims"],
          canR=pd[insts[0].boxKey+"Orient"]==="both";
    const maxCnt=bestSingleGridCount(dims,canR), take=Math.min(maxCnt,insts.length);
    return {
      placed:insts.slice(0,take).map(b=>({box:b})),
      notPlaced:insts.slice(take)
    };
  }
  // mixed SKU → guillotine
  let free=[{x:0,y:0,w:PALLET_L,h:PALLET_W}], rem=[...insts], placed=[];
  insts.forEach(inst=>{
    const pd=productsBySku[inst.sku], dims=pd[inst.boxKey+"Dims"],
          canR=pd[inst.boxKey+"Orient"]==="both",
          opts=[{l:dims.l,w:dims.w}];
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
      {x:slot.x+d.l,y:slot.y,w:slot.w-d.l,h:d.w},
      {x:slot.x,y:slot.y+d.w,w:slot.w,h:slot.h-d.w}
    );
  });
  return {placed,notPlaced:rem};
}

// ── 7) Optimize (with debug) ────────────────────────────────────────────────────
async function optimize(){
  console.clear();
  const cust=document.getElementById("customer").value.trim();
  if(!cust){ alert("Enter customer"); return; }
  const fi=document.getElementById("fileInput");
  if(!fi.files.length){ alert("Select file"); return; }

  let lines;
  try{ lines=await readOrderFile(fi.files[0]); }
  catch(e){ alert("Read error:"+e); console.error(e); return; }
  console.log("Order lines:",lines);

  // Check SKU lookup
  const missing=lines.filter(l=>!productsBySku[l.sku]).map(l=>l.sku);
  if(missing.length){
    alert("Missing SKUs in master-data: "+[...new Set(missing)].join(", "));
    console.warn("Missing SKUs:",missing);
    // continue anyway
  }

  // Expand
  let insts=[];
  lines.forEach(l=>{
    const pd=productsBySku[l.sku];
    if(!pd) return;
    const cap=pd[l.boxKey+"Units"], cnt=Math.ceil(l.units/cap);
    for(let i=0;i<cnt;i++) insts.push({
      sku:l.sku, name:pd.name, boxKey:l.boxKey,
      weight:pd[l.boxKey+"Weight"], dims:pd[l.boxKey+"Dims"],
      canRotate:pd[l.boxKey+"Orient"]==="both"
    });
  });
  console.log("Expanded instances:",insts);
  if(!insts.length){
    document.getElementById("results").innerHTML="<p><em>No boxes after expansion.</em></p>";
    return;
  }

  // Pack
  let rem=[...insts], pallets=[];
  while(rem.length){
    let usedH=0, wt=PALLET_EMPTY_WT, layers=[];
    while(true){
      const {placed,notPlaced}=packLayer(rem);
      if(!placed.length)break;
      const h=Math.max(...placed.map(p=>p.box.dims.h));
      if(usedH+h>PALLET_MAX_H) break;
      usedH+=h; wt+=placed.reduce((s,p)=>s+p.box.weight,0);
      layers.push(placed); rem=notPlaced;
    }
    pallets.push({layers,height:usedH,weight:wt});
  }
  console.log("Pallets:",pallets);

  // Render (omitted for brevity – reuse your existing renderer)
  document.getElementById("results").innerHTML=
    `<pre>See console for pallet structure</pre>`;
}

// ── 8) Hook button ─────────────────────────────────────────────────────────────
document.getElementById("go").addEventListener("click", optimize);
