// app.js
document.getElementById('go').addEventListener('click', async () => {
  const customer = document.getElementById('customer').value.trim();
  const fileInput = document.getElementById('fileInput');
  if (!customer || !fileInput.files.length) {
    alert('Please enter a customer name and choose an .xlsx file.');
    return;
  }

  // 1) Read Excel
  const data = await fileInput.files[0].arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, range: 3 });

  // 2) Extract real data rows (skip header row)
  const dataRows = rows.slice(1).filter(r => r[2]);
  const items = dataRows.map(r => ({
    sku:    r[2].toString().trim(),
    name:   r[3].toString().trim(),
    box:    r[4].toString().trim(),
    units:  Number(r[5]) || 0
  }));

  // 3) Render report
  let html = `<h2>PALLET 1</h2>`;
  html += `<h3>Layer 1</h3><ul>`;
  items.forEach(it => {
    html += `<li>${it.sku} | ${it.name} | ${it.units} units | ${it.box}</li>`;
  });
  html += `</ul>`;

  // 4) Totals
  const totalUnits = items.reduce((sum, it) => sum + it.units, 0);
  const totalBoxes = items.length;
  html += `<p><strong>SUMMARY PALLET 1:</strong> ${totalUnits} units | ${totalBoxes} boxes</p>`;
  html += `<h3>TOTAL: 1 pallet | ${totalBoxes} boxes | ${totalUnits} units</h3>`;

  document.getElementById('output').innerHTML = html;
});
