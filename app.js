// app.js

// Pallet specs
const PALLET_L = 120, PALLET_W = 80, PALLET_MAX_H = 170, PALLET_EMPTY_WT = 25;

let productsBySku = {};

function parseDims(s="0x0x0") {
  let [l,w,h] = s.split(/[x×]/i).map(Number);
  return { l, w, h };
}

// 1) Load master data
window.addEventListener('DOMContentLoaded', async () => {
  try {
    let r = await fetch('products-detail.json');
    let arr = await r.json();  // must be top-level array
    arr.forEach(p => {
      productsBySku[p.REF] = {
        name:       p.PRODUCT,
        box1Units:  Number(p["Box 1 Units"]) || 0,
        box1Weight: Number(p["Box 1 Weight (kg)"])||0,
        box1Orient: p["Box 1 Orientation (Horizontal / Both)"].toLowerCase(),
        box1Dims:   parseDims(p["Box 1 Dimensions (cm) (LxDxH)"]),
        box2Units:  Number(p["Box 2 Units"]) || 0,
        box2Weight: Number(p["Box 2 Weight (kg)"])||0,
        box2Orient: p["Box 2 Orientation (Horizontal / Both)"].toLowerCase(),
        box2Dims:   parseDims(p["Box 2 Dimensions (cm) (LxDxH)"])
      };
    });
  } catch(e) {
    alert('Failed to load products-detail.json');
    console.error(e);
  }
});

// 2) Read order XLSX
function readOrderFile(file) {
  return new Promise((res,rej) => {
    let fr = new FileReader();
    fr.onload = e => {
      try {
        let wb = XLSX.read(e.target.result, {type:"binary"});
        let sh = wb.Sheets[wb.SheetNames[0]];
        let rows = XLSX.utils.sheet_to_json(sh, {header:1, blankrows:false});
        let hdr = rows.find(r=>
          r.includes("REF") &&
          r.includes("BOX USED (BOX1 or BOX2)") &&
          r.includes("ORDER IN UNITS")
        );
        let iREF = hdr.indexOf("REF"),
            iBOX = hdr.indexOf("BOX USED (BOX1 or BOX2)"),
            iUN  = hdr.indexOf("ORDER IN UNITS");
        let lines = [];
        for(let i=rows.indexOf(hdr)+1;i<rows.length;i++){
          let r = rows[i];
          if(!r[iREF]) break;
          lines.push({
            sku:    r[iREF].toString().trim(),
            boxKey: r[iBOX].toString().trim().toLowerCase(),
            units:  Number(r[iUN])||0
          });
        }
        res(lines);
      } catch(err){ rej(err); }
    };
    fr.onerror = ()=> rej(fr.error);
    fr.readAsBinaryString(file);
  });
}

// 3) 5+2 grid solver
function bestSingleGridCount(d, canRotate){
  let best=0, L=PALLET_L, W=PALLET_W;
  let opts = [{l:d.l,w:d.w}];
  if(canRotate) opts.push({l:d.w,w:d.l});
  opts.forEach((o1,i1)=>{
    let rows=Math.floor(L/o1.l),
        cols=Math.floor(W/o1.w),
        base=rows*cols,
        remL=L-rows*o1.l,
        remW=W-cols*o1.w,
        extra=0;
    opts.forEach((o2,i2)=>{
      if(i1===i2) return;
      let c1=Math.floor(remL/o2.l)*Math.floor(W/o2.w),
          c2=Math.floor(L/o2.l)*Math.floor(remW/o2.w);
      extra = Math.max(extra, c1+c2);
    });
    best = Math.max(best, base+extra);
  });
  return best;
}

// 4) Pack one layer
function packLayer(insts){
  if(!insts.length) return {placed:[],notPlaced:[]};
  let sku0 = insts[0].sku;
  if(insts.every(x=>x.sku===sku0)){
    let pd = productsBySku[sku0],
        dims = pd[insts[0].boxKey+"Dims"],
        canR = pd[insts[0].boxKey+"Orient"]==="both",
        maxCnt = bestSingleGridCount(dims,canR),
        take = Math.min(maxCnt, insts.length);
    return {
      placed: insts.slice(0,take).map(b=>({box:b})),
      notPlaced: insts.slice(take)
    };
  }
  let free=[{x:0,y:0,w:PALLET_L,h:PALLET_W}], placed=[], rem=[...insts];
  insts.forEach(inst=>{
    let pd = productsBySku[inst.sku],
        dims = pd[inst.boxKey+"Dims"],
        canR = pd[inst.boxKey+"Orient"]==="both",
        opts=[{l:dims.l,w:dims.w}];
    if(canR) opts.push({l:dims.w,w:dims.l});
    let slot=null,d=null;
    outer: for(let r of free){
      for(let o of opts){
        if(o.l<=r.w && o.w<=r.h){ slot=r; d=o; break outer;}
      }
    }
    if(!slot) return;
    placed.push({box:inst,dims:d});
    rem = rem.filter(x=>x!==inst);
    free = free.filter(r=>r!==slot);
    free.push(
      {x:slot.x+d.l,y:slot.y,      w:slot.w-d.l,h:d.w},
      {x:slot.x,y:slot.y+d.w,      w:slot.w,    h:slot.h-d.w}
    );
  });
  return {placed,notPlaced:rem};
}

// 5) Optimize
async function optimize(){
  let cust = document.getElementById("customer").value.trim();
  if(!cust){ alert("Enter customer"); return; }
  let fi = document.getElementById("fileInput");
  if(!fi.files.length){ alert("Select file"); return; }
  let lines;
  try{ lines = await readOrderFile(fi.files[0]); }
  catch(e){ return alert("Read error: "+e.message); }
  if(!lines.length){
    document.getElementById("results").innerHTML = "<p><em>No valid lines</em></p>";
    return;
  }

  // expand
  let insts=[];
  lines.forEach(l=>{
    let pd = productsBySku[l.sku];
    if(!pd) return;
    let cap = pd[l.boxKey+"Units"],
        cnt = Math.ceil(l.units/cap);
    for(let i=0;i<cnt;i++){
      insts.push({
        sku:l.sku,name:pd.name,
        boxKey:l.boxKey,
        weight:pd[l.boxKey+"Weight"],
        dims:pd[l.boxKey+"Dims"],
        canRotate:pd[l.boxKey+"Orient"]==="both"
      });
    }
  });
  if(!insts.length){
    document.getElementById("results").innerHTML = "<p><em>No boxes after expansion.</em></p>";
    return;
  }

  // pack
  let rem=[...insts], pallets=[];
  while(rem.length){
    let usedH=0, wt=PALLET_EMPTY_WT, layers=[];
    while(true){
      let {placed,notPlaced} = packLayer(rem);
      if(!placed.length) break;
      let h = Math.max(...placed.map(x=>x.box.dims.h));
      if(usedH+h>PALLET_MAX_H) break;
      usedH+=h;
      wt+=placed.reduce((s,x)=>s+x.box.weight,0);
      layers.push(placed);
      rem = notPlaced;
    }
    pallets.push({layers,height:usedH,weight:wt});
  }

  // render
  let html=`<h1>${cust}</h1>`, grandWT=0;
  pallets.forEach((p,i)=>{
    html+=`<h2>Pallet ${i+1}</h2>`;
    let pUnits=0,pBoxes=0;
    p.layers.forEach((ly,li)=>{
      html+=`<h3>Layer ${li+1}</h3><table>
        <tr><th>SKU</th><th>Product</th><th style="text-align:right">Units</th>
            <th>Box</th><th style="text-align:right">Count</th></tr>`;
      let tally={};
      ly.forEach(x=>tally[x.box.sku]=(tally[x.box.sku]||0)+1);
      for(let sku in tally){
        let cnt=tally[sku], pd=productsBySku[sku],
            per=pd[ly[0].box.boxKey+"Units"],
            units=per*cnt;
        html+=`<tr>
          <td>${sku}</td><td>${pd.name}</td>
          <td style="text-align:right">${units}</td>
          <td>${ly[0].box.boxKey.toUpperCase()}</td>
          <td style="text-align:right">${cnt}</td>
        </tr>`;
        pUnits+=units; pBoxes+=cnt;
      }
      html+="</table>";
    });
    html+=`<p><strong>Summary:</strong> ${pUnits} units | ${pBoxes} boxes |
      Weight: ${p.weight.toFixed(1)} kg | Height: ${p.height} cm</p>`;
    grandWT+=p.weight;
  });
  html+=`<h2>Order Resume</h2>
    <p>Total pallets: ${pallets.length}<br>Total weight: ${grandWT.toFixed(1)} kg</p>`;
  document.getElementById("results").innerHTML = html;
}

document.getElementById("go").addEventListener("click", optimize);
