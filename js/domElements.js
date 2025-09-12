export const form = document.getElementById('roi-form');
export const resultDiv = document.getElementById('result');
export const roiResultElement = document.getElementById('roi-result');
export const paybackResultElement = document.getElementById('payback-result');
export const chartContainer = document.getElementById('roiChart').getContext('2d');

export const inputs = {
    systemCost: document.getElementById('system-cost'),
    batteryCost: document.getElementById('battery-cost'),
    annualConsumption: document.getElementById('annual-consumption'),
    solarGeneration: document.getElementById('solar-generation'),
    exportRate: document.getElementById('export-rate'),
    importRate: document.getElementById('import-rate'),
    selfConsumption: document.getElementById('self-consumption'),
    degradationRate: document.getElementById('degradation-rate'),
    inflationRate: document.getElementById('inflation-rate'),
    lifespan: document.getElementById('lifespan')
};