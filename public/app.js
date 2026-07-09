const riskSlider = document.getElementById('risk');
const riskValueLabel = document.getElementById('riskValue');
const halfLifeSlider = document.getElementById('halfLife');
const halfLifeValueLabel = document.getElementById('halfLifeValue');
const statsBody = document.getElementById('statsBody');
const rowCountEl = document.getElementById('rowCount');
const groupColEl = document.getElementById('groupCol');
const valueColEl = document.getElementById('valueCol');
const mostRecentYearEl = document.getElementById('mostRecentYear');

let debounceTimer = null;

async function loadMeta() {
  const res = await fetch('/api/meta');
  const meta = await res.json();
  rowCountEl.textContent = meta.rowCount;
  groupColEl.textContent = meta.groupCol;
  valueColEl.textContent = meta.valueCol;
  mostRecentYearEl.textContent = meta.mostRecentYear;
}

async function fetchStats(risk, halfLife) {
  const res = await fetch(`/api/stats?risk=${risk}&halfLife=${halfLife}`);
  if (!res.ok) {
    statsBody.innerHTML = `<tr><td colspan="6">Error loading stats</td></tr>`;
    return;
  }
  const data = await res.json();
  renderStats(data.stats);
}

function renderStats(stats) {
  statsBody.innerHTML = stats
    .map(
      (row, i) => `
      <tr>
        <td class="rank">${i + 1}</td>
        <td class="group-name">${row.group}</td>
        <td>${row.n}</td>
        <td>${row.mean.toFixed(2)}</td>
        <td>${row.sd.toFixed(2)}</td>
        <td class="adj-avg">${row.adjAvg.toFixed(2)}</td>
      </tr>`
    )
    .join('');
}

function currentValues() {
  return {
    risk: parseFloat(riskSlider.value),
    halfLife: parseFloat(halfLifeSlider.value)
  };
}

function scheduleFetch() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const { risk, halfLife } = currentValues();
    fetchStats(risk, halfLife);
  }, 80);
}

riskSlider.addEventListener('input', () => {
  riskValueLabel.textContent = parseFloat(riskSlider.value).toFixed(2);
  scheduleFetch();
});

halfLifeSlider.addEventListener('input', () => {
  const val = parseFloat(halfLifeSlider.value);
  halfLifeValueLabel.textContent = val === 0 ? '0 (off)' : val.toFixed(1);
  scheduleFetch();
});

(async function init() {
  await loadMeta();
  riskValueLabel.textContent = parseFloat(riskSlider.value).toFixed(2);
  const initHalfLife = parseFloat(halfLifeSlider.value);
  halfLifeValueLabel.textContent = initHalfLife === 0 ? '0 (off)' : initHalfLife.toFixed(1);
  const { risk, halfLife } = currentValues();
  await fetchStats(risk, halfLife);
})();
