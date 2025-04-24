// app.js

// 1) Load simple master data (products.json)
let masterData = {};
window.addEventListener('DOMContentLoaded', async () => {
  const resp = await fetch(`products.json?cb=${Date.now()}`);
  masterData = await resp.json();
});

// 2) On “Upload & Optimize”
document.getElementById('go').addEventListener('click', async () => {
  const cust = document.getElementById('customer').value.trim();
  const fi   = document.getElementById('fileInput');
  if (!cust || !fi.files.length) {
    return alert('Please enter a customer name and pick an .xlsx file.');
  }

  // 3) Read the first sheet, skip first 3 rows
  const buf = await fi.files[0].arrayBuffer();
  const wb  = XLSX.read(buf, { type:'array' });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header:1, range:3 });

  // 4) Filter and map to items
  const items = rows
    .filter(r => Array.isArray(r) && r[2] && r[2].toString().toUpperCase()!=='REF')
    .map(r => {
      const sku    = r[2].toString().trim();
      const name   = r[3].toString().trim();
      const boxKey = r[4].toString().trim().toLowerCase(); // “box1” or “box2”
      const units  = Number(r[5]) || 0;
      const perBox = masterData[sku]?.[boxKey]?.units || 1;
      const boxes  = Math.ceil(units / perBox);
      return { sku, name, units, boxKey: boxKey.toUpperCase(), boxes };
    });

  // 5) Render the simple table
  let html = `<h2>${cust}</h2><h3>PALLET 1</h3>
    <table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;">
      <thead>
        <tr>
          <th>SKU</th><th>Product</th><th>Units</th>
          <th>Box Type</th><th># Boxes</th>
        </tr>
      </thead><tbody>`;
  items.forEach(it => {
    html += `<tr>
      <td>${it.sku}</td>
      <td>${it.name}</td>
      <td style="text-align:right">${it.units}</td>
      <td style="text-align:center">${it.boxKey}</td>
      <td style="text-align:right">${it.boxes}</td>
    </tr>`;
  });
  const totalUnits = items.reduce((s,i)=>s+i.units,0);
  const totalBoxes = items.reduce((s,i)=>s+i.boxes,0);
  html += `</tbody></table>
    <p><strong>SUMMARY PALLET 1:</strong> ${totalUnits} units | ${totalBoxes} boxes</p>
    <h3>TOTAL: 1 pallet | ${totalBoxes} boxes | ${totalUnits} units</h3>`;

  document.getElementById('output').innerHTML = html;
});
