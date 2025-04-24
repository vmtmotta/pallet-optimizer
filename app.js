// app.js

// Pallet specifications
const PALLET_L        = 120;  // cm
const PALLET_W        =  80;  // cm
const PALLET_MAX_H    = 170;  // cm
const PALLET_EMPTY_WT =  25;  // kg

let productsBySku = {};

// Utility: parse "LxWxH"
function parseDims(s="0x0x0") {
  const [l,w,h] = s.split(/[x×]/i).map(Number);
  return { l, w, h };
}

// 1) Load your JSON master-data (must be an array of objects)
window.addEventListener('DOMContentLoaded', async () => {
-  const resp = await fetch('products-detail.json');
-  const data = await resp.json();    // <-- data might be an object
-  data.forEach(p => {
+  const resp = await fetch('products-detail.json');
+  let data = await resp.json();
+  // if JSON was an object keyed by SKU, turn it into an array of values:
+  if (!Array.isArray(data)) data = Object.values(data);
+  data.forEach(p => {
     productsBySku[p.REF] = {
       name:       p.PRODUCT,
       box1Units:  Number(p["Box 1 Units"]) || 0,
       // …etc…
     };
   });
  } catch (e) {
    alert("Could not load products-detail.json");
    console.error(e);
  }
});

// 2) Read the order .xlsx
function readOrderFile(file) {
  return new Promise((resolve,reject) => {
    const fr = new FileReader();
    fr.onload = e => {
      try {
        const wb    = XLSX.read(e.target.result, { type:'binary' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows  = XLSX.utils.sheet_to_json(sheet, { header:1, blankrows:false });
        const hdr   = rows.find(r =>
          r.includes("REF") &&
          r.includes("BOX USED (BOX1 or BOX2)") &&
          r.includes("ORDER IN UNITS")
        );
        const iREF = hdr.indexOf("REF"),
              iBOX = hdr.indexOf("BOX USED (BOX1 or BOX2)"),
              iUN  = hdr.indexOf("ORDER IN UNITS");
        const lines = [];
        for (let i = rows.indexOf(hdr)+1; i < rows.length; i++) {
          const r = rows[i];
          if (!r[iREF]) break;
          lines.push({
            sku:    r[iREF].toString().trim(),
            boxKey: r[iBOX].toString().trim().toLowerCase(),
            units:  Number(r[iUN]) || 0
          });
        }
        resolve(lines);
      } catch (err) {
        reject(err);
      }
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsBinaryString(file);
  });
}

// 3) Simple 5+2 grid count for same-SKU
function bestSingleGridCount(d, canRotate) {
  let best = 0, L = PALLET_L, W = PALLET_W;
  const opts = [{l:d.l,w:d.w}];
  if (canRotate) opts.push({l:d.w,w:d.l});
  opts.forEach((o1,i1) => {
    const rows = Math.floor(L/o1.l), cols = Math.floor(W/o1.w);
    const base = rows*cols;
    const remL = L - rows*o1.l, remW = W - cols*o1.w;
    let extra = 0;
    opts.forEach((o2,i2) => {
      if (i1===i2) return;
      const c1 = Math.floor(remL/o2.l)*Math.floor(W/o2.w);
      const c2 = Math.floor(L/o2.l)*Math.floor(remW/o2.w);
      extra = Math.max(extra, c1 + c2);
    });
    best = Math.max(best, base + extra);
  });
  return best;
}

// 4) Pack one layer
function packLayer(insts) {
  if (!insts.length) return { placed:[], notPlaced:[] };
  const sku0 = insts[0].sku;
  if (insts.every(x=>x.sku===sku0)) {
    const pd    = productsBySku[sku0];
    const dims  = pd[insts[0].boxKey + "Dims"];
    const canR  = pd[insts[0].boxKey + "Orient"] === "both";
    const maxN  = bestSingleGridCount(dims, canR);
    const take  = Math.min(maxN, insts.length);
    return {
      placed: insts.slice(0,take).map(b=>({box:b})),
      notPlaced: insts.slice(take)
    };
  }
  // mixed-SKU: simple guillotine
  let free=[{x:0,y:0,w:PALLET_L,h:PALLET_W}], placed=[], rem=[...insts];
  insts.forEach(inst=>{
    const pd   = productsBySku[inst.sku];
    const dims = pd[inst.boxKey + "Dims"];
    const canR = pd[inst.boxKey + "Orient"] === "both";
    const opts = [{l:dims.l,w:dims.w}];
    if (canR) opts.push({l:dims.w,w:dims.l});
    let slot=null, d=null;
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
      {x:slot.x+d.l, y:slot.y,       w:slot.w-d.l, h:d.w},
      {x:slot.x,     y:slot.y+d.w,   w:slot.w,     h:slot.h-d.w}
    );
  });
  return { placed, notPlaced:rem };
}

// 5) Main
async function optimize() {
  const cust = document.getElementById("customer").value.trim();
  if (!cust) return alert("Enter customer");
  const fi = document.getElementById("fileInput");
  if (!fi.files.length) return alert("Select file");
  let lines;
  try { lines = await readOrderFile(fi.files[0]); }
  catch (e) { return alert("Read error: "+e.message); }
  if (!lines.length) {
    document.getElementById("results").innerHTML = "<p><em>No valid lines</em></p>";
    return;
  }

  // expand into instances
  let insts = [];
  lines.forEach(l => {
    const pd = productsBySku[l.sku];
    if (!pd) return;
    const cap = pd[l.boxKey + "Units"];
    const cnt = Math.ceil(l.units / cap);
    for (let i=0;i<cnt;i++){
      insts.push({
        sku: l.sku,
        name: pd.name,
        boxKey: l.boxKey,
        weight: pd[l.boxKey + "Weight"],
        dims: pd[l.boxKey + "Dims"],
        canRotate: pd[l.boxKey + "Orient"] === "both"
      });
    }
  });
  if (!insts.length) {
    document.getElementById("results").innerHTML =
      "<p><em>No boxes after expansion.</em></p>";
    return;
  }

  // pack into pallets
  let rem=[...insts], pallets=[];
  while (rem.length) {
    let usedH=0, wt=PALLET_EMPTY_WT, layers=[];
    while (true) {
      const { placed, notPlaced } = packLayer(rem);
      if (!placed.length) break;
      const h = Math.max(...placed.map(x=>x.box.dims.h));
      if (usedH + h > PALLET_MAX_H) break;
      usedH += h;
      wt   += placed.reduce((s,x)=>s + x.box.weight,0);
      layers.push(placed);
      rem = notPlaced;
    }
    pallets.push({ layers, height:usedH, weight:wt });
  }

  // render results
  let html = `<h1>${cust}</h1>`, grand=0;
  pallets.forEach((p,i)=>{
    html += `<h2>PALLET ${i+1}</h2>`;
    let pu=0,pb=0;
    p.layers.forEach((ly, li)=>{
      html += `<h3>Layer ${li+1}</h3><table>
        <tr><th>SKU</th><th>Product</th><th style="text-align:right">Units</th>
            <th>Box</th><th style="text-align:right">Count</th></tr>`;
      const tally={};
      ly.forEach(x=>tally[x.box.sku]=(tally[x.box.sku]||0)+1);
      for (let sku in tally) {
        const cnt=tally[sku], pd=productsBySku[sku],
              per=pd[ly[0].box.boxKey+"Units"],
              units=per*cnt;
        html += `<tr>
          <td>${sku}</td><td>${pd.name}</td>
          <td style="text-align:right">${units}</td>
          <td>${ly[0].box.boxKey.toUpperCase()}</td>
          <td style="text-align:right">${cnt}</td>
        </tr>`;
        pu += units; pb += cnt;
      }
      html += `</table>`;
    });
    html += `<p><strong>Summary:</strong> ${pu} units | ${pb} boxes |
      Weight: ${p.weight.toFixed(1)} kg | Height: ${p.height} cm</p>`;
    grand += p.weight;
  });
  html += `<h2>Order Resume</h2>
    <p>Total pallets: ${pallets.length}<br>
       Total weight: ${grand.toFixed(1)} kg</p>`;

  document.getElementById("results").innerHTML = html;
}

document.getElementById("go").addEventListener("click", optimize);
