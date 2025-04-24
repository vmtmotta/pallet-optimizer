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

  // 5) Render your formatted report
  let html = `<h2>PALLET 1</h2><h3>Layer 1</h3><ul>`;
  items.forEach(it => {
    html += `<li>${it.sku} | ${it.name} | ${it.units} units | ${it.boxKey} → ${it.boxes} boxes</li>`;
  });
  html += `</ul>`;

  // 6) Totals
  const totalUnits = items.reduce((sum, it) => sum + it.units, 0);
  const totalBoxes = items.reduce((sum, it) => sum + it.boxes, 0);
  html += `<p><strong>SUMMARY PALLET 1:</strong> ${totalUnits} units | ${totalBoxes} boxes</p>`;
  html += `<h3>TOTAL: 1 pallet | ${totalBoxes} boxes | ${totalUnits} units</h3>`;

  document.getElementById('output').innerHTML = html;
});
