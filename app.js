// app.js

let masterData = {};

// 1) On load, fetch the products.json mapping
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const resp = await fetch('products.json');
    masterData = await resp.json();
  } catch (e) {
    console.error('Error loading products.json', e);
    alert('Could not load product data.');
  }
});

document.getElementById('go').addEventListener('click', async () => {
  const customer = document.getElementById('customer').value.trim();
  const fileInput = document.getElementById('fileInput');
  if (!customer || !fileInput.files.length) {
    alert('Please enter customer name and select an .xlsx file.');
    return;
  }

  // 2) Parse Excel
  const data = await fileInput.files[0].arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, range: 3 });

  // 3) Filter data rows (skip REF header & blanks)
  const dataRows = rows.filter(r =>
    Array.isArray(r) &&
    r[2] &&
    r[2].toString().trim().toUpperCase() !== 'REF'
  );

  // 4) Map to items with units & compute boxes
  const items = dataRows.map(r => {
    const sku   = r[2].toString().trim();
    const name  = r[3].toString().trim();
    const boxKey= r[4].toString().trim().toUpperCase(); // "BOX1" or "BOX2"
    const units = Number(r[5]) || 0;

    const pd = masterData[sku] || {};
    const perBox = boxKey === 'BOX1' ? pd.box1Units : pd.box2Units;
    const boxes = perBox ? Math.ceil(units / perBox) : 0;

    return { sku, name, boxKey, units, boxes };
  });

 // 5) Render your formatted report as a table
let html = `<h2>PALLET 1</h2>`;
html += `
  <table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;">
    <thead>
      <tr>
        <th>SKU</th>
        <th>Product</th>
        <th>Units</th>
        <th>Box Type</th>
        <th>Boxes Needed</th>
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

// 6) Totals (below the table)
const totalUnits = items.reduce((sum, it) => sum + it.units, 0);
const totalBoxes = items.reduce((sum, it) => sum + it.boxes, 0);
html += `<p>
  <strong>SUMMARY PALLET 1:</strong>
  ${totalUnits} units | ${totalBoxes} boxes
</p>`;
html += `<h3>TOTAL: 1 pallet | ${totalBoxes} boxes | ${totalUnits} units</h3>`;
