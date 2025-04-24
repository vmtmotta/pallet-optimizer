// app.js
console.log('🔥 app.js loaded');
let masterData = {};

// 1) Load product box sizes
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const resp = await fetch(`products.json?cachebust=${Date.now()}`);
    masterData = await resp.json();
  } catch (e) {
    console.error('Could not load products.json', e);
    alert('Failed to load product data.');
  }
});

document.getElementById('go').addEventListener('click', async () => {
  // 2) Get inputs
  const customer = document.getElementById('customer').value.trim();
  const fileInput = document.getElementById('fileInput');
  if (!customer || !fileInput.files.length) {
    alert('Enter customer and select an .xlsx file.');
    return;
  }

  // 3) Read Excel
  const data = await fileInput.files[0].arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, range: 3 });

  // 4) Filter out blank rows & header
  const dataRows = rows.filter(r => Array.isArray(r) && r[2] && r[2].toString().trim().toUpperCase() !== 'REF');

  // 5) Map to items & compute boxes
  const items = dataRows.map(r => {
    const sku   = r[2].toString().trim();
    const name  = r[3].toString().trim();
    const boxKey= r[4].toString().trim().toUpperCase(); // BOX1 or BOX2
    const units = Number(r[5]) || 0;
    const pd    = masterData[sku] || {};
    const perBox= boxKey === 'BOX1' ? pd.box1Units : pd.box2Units;
    const boxes = perBox ? Math.ceil(units / perBox) : 0;
    return { sku, name, units, boxKey, boxes };
  });

  // 6) Build HTML table
  let html = `<h2>PALLET 1</h2>`;
  html += `
    <table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse; width:100%;">
      <thead>
        <tr>
          <th>SKU</th>
          <th>Product</th>
          <th style="text-align:right;">Units</th>
          <th>Box Type</th>
          <th style="text-align:right;">Boxes Needed</th>
        </tr>
      </thead>
      <tbody>
  `;
  items.forEach(it => {
    html += `
      <tr>
        <td>${it.sku}</td>
        <td>${it.name}</td>
        <td style="text-align:right;">${it.units}</td>
        <td style="text-align:center;">${it.boxKey}</td>
        <td style="text-align:right;">${it.boxes}</td>
      </tr>
    `;
  });
  html += `
      </tbody>
    </table>
  `;

  // 7) Totals
  const totalUnits = items.reduce((sum, it) => sum + it.units, 0);
  const totalBoxes = items.reduce((sum, it) => sum + it.boxes, 0);
  html += `<p><strong>SUMMARY PALLET 1:</strong> ${totalUnits} units | ${totalBoxes} boxes</p>`;
  html += `<h3>TOTAL: 1 pallet | ${totalBoxes} boxes | ${totalUnits} units</h3>`;

  // 8) Render
  document.getElementById('output').innerHTML = html;
});
