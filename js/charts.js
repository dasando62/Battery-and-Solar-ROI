// js/charts.js
// Version 9.6

import { state } from './state.js';

// UPDATED: The function now accepts a combined array of datasets 
// and no longer creates its own 'Capital Outlay' line.
export function updateCharts(numYears, systemCost, datasets) {
  const ctx = document.getElementById("savingsChart")?.getContext("2d");
  if (!ctx) return;
  if (state.myChart) state.myChart.destroy();
  state.myChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array.from({ length: numYears }, (_, i) => `Year ${i + 1}`),
      datasets: datasets // Use the datasets passed in directly
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: 'Cumulative Net Savings vs. Initial Cost' }
      },
      scales: {
        x: { title: { display: true, text: 'Years' } },
        y: { title: { display: true, text: 'Cumulative Savings ($)' } }
      }
    }
  });
}