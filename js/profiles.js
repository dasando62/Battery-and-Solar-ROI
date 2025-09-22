// js/profiles.js
// Version 7.8
export function generateHourlyConsumptionProfileFromDailyTOU(dailyPeak, dailyShoulder, dailyOffPeak) {
  const hourlyConsumption = Array(24).fill(0);
  // This logic assumes a standard TOU schedule. The user-defined hours are handled in the main analysis.
  const peakHours = 9,
    shoulderHours = 6,
    offPeakHours = 9;
  for (let i = 0; i < 24; i++) {
    if ((i >= 7 && i < 10) || (i >= 16 && i < 22)) hourlyConsumption[i] = dailyPeak > 0 ? dailyPeak / peakHours : 0;
    else if (i >= 10 && i < 16) hourlyConsumption[i] = dailyShoulder > 0 ? dailyShoulder / shoulderHours : 0;
    else hourlyConsumption[i] = dailyOffPeak > 0 ? dailyOffPeak / offPeakHours : 0;
  }
  return hourlyConsumption;
}


// --- NEW SEASONAL SOLAR PROFILES ---

// Generic annual average profile (used as a fallback)
const genericSolarDistribution = [0, 0, 0, 0, 0, 0, 0, 0.01, 0.05, 0.1, 0.15, 0.19, 0.2, 0.15, 0.1, 0.04, 0.01, 0, 0, 0, 0, 0, 0, 0];

// High, long curve for summer
const summerSolarDistribution = [0, 0, 0, 0, 0, 0, 0.01, 0.04, 0.08, 0.12, 0.15, 0.18, 0.19, 0.15, 0.12, 0.08, 0.04, 0.01, 0, 0, 0, 0, 0, 0];

// Low, short curve for winter
const winterSolarDistribution = [0, 0, 0, 0, 0, 0, 0, 0, 0.05, 0.1, 0.18, 0.22, 0.2, 0.15, 0.1, 0.0, 0, 0, 0, 0, 0, 0, 0, 0];

// Balanced curve for shoulder seasons
const shoulderSolarDistribution = [0, 0, 0, 0, 0, 0, 0, 0.02, 0.06, 0.11, 0.16, 0.19, 0.19, 0.16, 0.11, 0.06, 0.02, 0, 0, 0, 0, 0, 0, 0];


// This function now selects the correct profile based on the season
export function generateHourlySolarProfileFromDaily(dailyTotal, season = 'Q_Manual') {
  if (dailyTotal <= 0) return Array(24).fill(0);

  let distribution;
  switch (season) {
    case 'Q1_Summer':
      distribution = summerSolarDistribution;
      break;
    case 'Q3_Winter':
      distribution = winterSolarDistribution;
      break;
    case 'Q2_Autumn':
    case 'Q4_Spring':
      distribution = shoulderSolarDistribution;
      break;
    default: // Fallback for single manual input
      distribution = genericSolarDistribution;
      break;
  }

  const distributionTotal = distribution.reduce((a, b) => a + b, 0);
  // Normalize and scale the distribution to match the daily total
  return distribution.map(val => (val / distributionTotal) * dailyTotal);
}