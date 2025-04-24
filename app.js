// app.js

// Pallet constraints (unchanged)…
const PALLET_LENGTH = 120, PALLET_WIDTH = 80;
const MAX_HEIGHT = 170, MAX_GROSS_WT = 600, PALLET_WT = 25;

let products = {};
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const resp = await fetch(`products-detail.json?cb=${Date.now()}`);
    products = await resp.json();
    console.log('✅ Loaded products-detail.json, SKUs:', Object.keys(products).length);
  } catch (e) {
    console.error('❌ Failed to load products-detail.json', e);
  }
});

document.getElementById('go').addEventListener('click', async () => {
  const customer = document.getElementById('customer').value.trim();
  const fileInput = document.getElementById('fileInput');
  if (!customer || !fileInput.files.length) {
    return alert('Please enter a customer and select an .xlsx file.');
  }

  // 1) Read workbook
  const buf = await fileInput.files[0].arrayBuffer();
  const wb  = XLSX.read(buf, { type: 'array' });
  console.log('Workbook sheets:', wb.SheetNames);

  // 2) Use first sheet
  const sheetName = wb.SheetNames[0];
  console.log('Using sheet:', sheetName);
  const ws = wb.Sheets[sheetName];

  // 3) Convert to array rows, skipping 3 header rows
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, range: 3 });
  console.log(`Read ${rows.length} data rows. First 5:`);
  console.table(rows.slice(0, 5));

  // 4) Build instances
  const instances = [];
  rows.forEach((r, idx) => {
    // Log each row’s first 6 columns
    console.log(`Row ${idx}:`, r.slice(0,6));
    const sku    = r[2]?.toString().trim();
    const name   = r[3]?.toString().trim() || sku;
    const choice = r[4]?.toString().trim();
    const units  = Number(r[5]) || 0;

    if (!sku || !choice || units <= 0) {
      console.warn(`  ↳ SKIPPING row ${idx}: missing sku/choice/units`);
      return;
    }

    const pd  = products[sku];
    if (!pd) {
      console.warn(`  ↳ NO product data for SKU: ${sku}`);
      return;
    }

    const boxKey = 'box' + choice; // "box1" or "box2"
    const boxP   = pd[boxKey];
    if (!boxP || !boxP.units) {
      console.warn(`  ↳ NO box data for ${sku} → ${boxKey}`);
      return;
    }

    const count = Math.ceil(units / boxP.units);
    console.log(`  ↳ SKU ${sku}: ${units} units, ${boxKey} holds ${boxP.units}, count = ${count}`);

    for (let i = 0; i < count; i++) {
      const [L,D,H] = boxP.dimensions;
      const canBoth = boxP.orientation.toLowerCase() === 'both';
      instances.push({
        sku, name,
        fragility: pd.fragility.toLowerCase(),
        weight:    boxP.weight,
        dims:      { l: L, w: D, h: H },
        orientation: boxP.orientation.toLowerCase(),
        canRotate:   canBoth
      });
    }
  });

  console.log('Total box instances built:', instances.length);
  if (!instances.length) {
    return document.getElementById('output').innerHTML =
      '<p><em>No boxes to pack. Check your order file.</em></p>';
  }

  // … rest of packing+rendering logic unchanged …
  // (you can paste in your existing packLayer() + render() here)
});
