// app.js

// 1) Load your box‐capacity master data (products.json)
let masterData = {};
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const resp = await fetch(`products.json?cachebust=${Date.now()}`);
    masterData = await resp.json();
    console.log('✅ Loaded products.json');
  } catch (e) {
    console.error('❌ Could not load products.json', e);
    alert('Error loading master data.');
  }
});

// 2) On “Upload & Optimize”
document.getElementById('go').addEventListener('click', async () => {
  const cust = document.getElementById('customer').value.trim();
  const fileInput = document.getElementById('fileInput');
  if (!cust || !fileInput.files.length) {
    return alert('Enter a customer and select an .xlsx file.');
  }

  // 3) Read the workbook & first sheet
  const data = await fileInput.files[0].arrayBuffer();
  const wb   = XLSX.read(data, { type: 'array' });
  const ws   = wb.Sheets[wb.SheetNames[0]];

  // 4) Convert to rows, skipping the first 3 header rows
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, range: 3 });

  // 5) Filter out blank or header rows
  const dataRows = rows.filter(r =>
    Array.isArray(r) &&
    r[2] && r[2].toString().trim().toUpperCase() !== 'REF'
  );

  // 6) Map each row → an item with sku, name, units, boxKey, boxesNeeded
  const items = dataRows.map(r => {
    const sku    = r[2].toString().trim();
    const name   = r[3].toString().trim();
    const boxKey = r[4].toString().trim().toLowerCase(); // “box1” or “box2”
    const units  = Number(r[5]) || 0;
    const pd     = masterData[sku] || {};
    const perBox = pd[boxKey]?.units || 1;
    const boxes  = Math.ceil(units / perBox);
    return { sku, name, units, boxKey: boxKey.toUpperCase(), boxes };
  });

  // 7) Build the HTML table
  let html = `<h2>PALLET 1</h2>
    <table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse; width:100%">
      <thead>
        <tr>
          <th>SKU</th>
          <th>Product</th>
          <th style="text-align:right">Units</th>
          <th>Box Used</th>
          <th style="text-align:right"># Boxes</th>
        </tr>
      </thead>
      <tbody>
  `;
  items.forEach(it => {
    html += `
      <tr>
        <td>${it.sku}</td>
        <td>${it.name}</td>
        <td style="text-align:right">${it.units}</td>
        <td style="text-align:center">${it.boxKey}</td>
        <td style="text-align:right">${it.boxes}</td>
      </tr>`;
  });
  html += `
      </tbody>
    </table>`;

  // 8) Totals summary
  const totalUnits = items.reduce((sum, it) => sum + it.units, 0);
  const totalBoxes = items.reduce((sum, it) => sum + it.boxes, 0);
  html += `<p><strong>SUMMARY PALLET 1:</strong> ${totalUnits} units | ${totalBoxes} boxes</p>`;
  html += `<h3>TOTAL: 1 pallet | ${totalBoxes} boxes | ${totalUnits} units</h3>`;

  // 9) Render into #output
  document.getElementById('output').innerHTML = html;
});
