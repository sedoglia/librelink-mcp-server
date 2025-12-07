/**
 * Glucose Analytics Module
 * 
 * Calculates statistics, time-in-range, GMI, and pattern recognition
 */

import { GlucoseReading, GlucoseStats, GlucoseTrends, LibreLinkConfig } from './types.js';

export class GlucoseAnalytics {
  private config: LibreLinkConfig;

  constructor(config: LibreLinkConfig) {
    this.config = config;
  }

  /**
   * Calculate comprehensive glucose statistics
   */
  calculateGlucoseStats(readings: GlucoseReading[]): GlucoseStats {
    if (readings.length === 0) {
      return {
        average: 0,
        gmi: 0,
        timeInRange: 0,
        timeBelowRange: 0,
        timeAboveRange: 0,
        standardDeviation: 0,
        coefficientOfVariation: 0,
        readingCount: 0
      };
    }

    const values = readings.map(r => r.value);
    const n = values.length;

    // Calculate average
    const sum = values.reduce((a, b) => a + b, 0);
    const average = sum / n;

    // Calculate standard deviation
    const squaredDiffs = values.map(v => Math.pow(v - average, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / n;
    const standardDeviation = Math.sqrt(avgSquaredDiff);

    // Calculate coefficient of variation
    const coefficientOfVariation = (standardDeviation / average) * 100;

    // Calculate GMI (Glucose Management Indicator)
    // GMI = 3.31 + 0.02392 × [mean glucose in mg/dL]
    const gmi = 3.31 + (0.02392 * average);

    // Calculate time in range
    const inRange = values.filter(v => v >= this.config.targetLow && v <= this.config.targetHigh).length;
    const belowRange = values.filter(v => v < this.config.targetLow).length;
    const aboveRange = values.filter(v => v > this.config.targetHigh).length;

    const timeInRange = (inRange / n) * 100;
    const timeBelowRange = (belowRange / n) * 100;
    const timeAboveRange = (aboveRange / n) * 100;

    return {
      average: Math.round(average * 100) / 100,
      gmi: Math.round(gmi * 100) / 100,
      timeInRange: Math.round(timeInRange * 100) / 100,
      timeBelowRange: Math.round(timeBelowRange * 100) / 100,
      timeAboveRange: Math.round(timeAboveRange * 100) / 100,
      standardDeviation: Math.round(standardDeviation * 100) / 100,
      coefficientOfVariation: Math.round(coefficientOfVariation * 100) / 100,
      readingCount: n
    };
  }

  /**
   * Analyze glucose trends and patterns
   */
  analyzeTrends(readings: GlucoseReading[], period: 'daily' | 'weekly' | 'monthly'): GlucoseTrends {
    const patterns: string[] = [];
    let dawnPhenomenon = false;
    let mealResponse = 0;
    let overnightStability = 0;

    if (readings.length === 0) {
      return { patterns, dawnPhenomenon, mealResponse, overnightStability };
    }

    // Group readings by hour of day
    const byHour = this.groupByHour(readings);

    // Check for dawn phenomenon (rise between 3am-8am)
    dawnPhenomenon = this.detectDawnPhenomenon(byHour);
    if (dawnPhenomenon) {
      patterns.push('Dawn phenomenon detected - glucose rises in early morning');
    }

    // Calculate overnight stability (10pm-6am)
    overnightStability = this.calculateOvernightStability(byHour);
    if (overnightStability < 10) {
      patterns.push('Excellent overnight glucose stability');
    } else if (overnightStability < 20) {
      patterns.push('Good overnight glucose stability');
    } else {
      patterns.push('Variable overnight glucose - consider reviewing evening routine');
    }

    // Analyze meal responses (approximate based on typical meal times)
    mealResponse = this.analyzeMealResponse(byHour);
    if (mealResponse < 30) {
      patterns.push('Good postprandial glucose control');
    } else if (mealResponse < 50) {
      patterns.push('Moderate postprandial glucose rises');
    } else {
      patterns.push('High postprandial glucose spikes - consider meal composition');
    }

    // Check time in range trend
    const stats = this.calculateGlucoseStats(readings);
    if (stats.timeInRange >= 70) {
      patterns.push(`Excellent time in range: ${stats.timeInRange.toFixed(1)}%`);
    } else if (stats.timeInRange >= 50) {
      patterns.push(`Good time in range: ${stats.timeInRange.toFixed(1)}%`);
    } else {
      patterns.push(`Time in range needs improvement: ${stats.timeInRange.toFixed(1)}%`);
    }

    // Check variability
    if (stats.coefficientOfVariation < 33) {
      patterns.push('Low glucose variability - stable control');
    } else {
      patterns.push('High glucose variability - consider consistency improvements');
    }

    return {
      patterns,
      dawnPhenomenon,
      mealResponse: Math.round(mealResponse * 100) / 100,
      overnightStability: Math.round(overnightStability * 100) / 100
    };
  }

  /**
   * Group readings by hour of day
   */
  private groupByHour(readings: GlucoseReading[]): Map<number, number[]> {
    const byHour = new Map<number, number[]>();

    for (let i = 0; i < 24; i++) {
      byHour.set(i, []);
    }

    for (const reading of readings) {
      const hour = new Date(reading.timestamp).getHours();
      const values = byHour.get(hour) || [];
      values.push(reading.value);
      byHour.set(hour, values);
    }

    return byHour;
  }

  /**
   * Detect dawn phenomenon
   */
  private detectDawnPhenomenon(byHour: Map<number, number[]>): boolean {
    // Get average for early morning (3-4am) and later morning (6-8am)
    const earlyMorning: number[] = [];
    const laterMorning: number[] = [];

    for (let h = 3; h <= 4; h++) {
      earlyMorning.push(...(byHour.get(h) || []));
    }

    for (let h = 6; h <= 8; h++) {
      laterMorning.push(...(byHour.get(h) || []));
    }

    if (earlyMorning.length === 0 || laterMorning.length === 0) {
      return false;
    }

    const earlyAvg = earlyMorning.reduce((a, b) => a + b, 0) / earlyMorning.length;
    const laterAvg = laterMorning.reduce((a, b) => a + b, 0) / laterMorning.length;

    // Dawn phenomenon if later morning is significantly higher (>20 mg/dL)
    return (laterAvg - earlyAvg) > 20;
  }

  /**
   * Calculate overnight stability (standard deviation of overnight readings)
   */
  private calculateOvernightStability(byHour: Map<number, number[]>): number {
    const overnightValues: number[] = [];

    // 10pm-6am
    for (let h = 22; h <= 23; h++) {
      overnightValues.push(...(byHour.get(h) || []));
    }
    for (let h = 0; h <= 6; h++) {
      overnightValues.push(...(byHour.get(h) || []));
    }

    if (overnightValues.length < 2) {
      return 0;
    }

    const avg = overnightValues.reduce((a, b) => a + b, 0) / overnightValues.length;
    const squaredDiffs = overnightValues.map(v => Math.pow(v - avg, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / overnightValues.length;

    return Math.sqrt(variance);
  }

  /**
   * Analyze meal response (glucose rise after typical meal times)
   */
  private analyzeMealResponse(byHour: Map<number, number[]>): number {
    const mealTimes = [
      { before: [6, 7], after: [8, 9] },      // Breakfast
      { before: [11, 12], after: [13, 14] },  // Lunch
      { before: [17, 18], after: [19, 20] }   // Dinner
    ];

    const rises: number[] = [];

    for (const meal of mealTimes) {
      const beforeValues: number[] = [];
      const afterValues: number[] = [];

      for (const h of meal.before) {
        beforeValues.push(...(byHour.get(h) || []));
      }
      for (const h of meal.after) {
        afterValues.push(...(byHour.get(h) || []));
      }

      if (beforeValues.length > 0 && afterValues.length > 0) {
        const beforeAvg = beforeValues.reduce((a, b) => a + b, 0) / beforeValues.length;
        const afterAvg = afterValues.reduce((a, b) => a + b, 0) / afterValues.length;
        rises.push(Math.max(0, afterAvg - beforeAvg));
      }
    }

    if (rises.length === 0) {
      return 0;
    }

    return rises.reduce((a, b) => a + b, 0) / rises.length;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<LibreLinkConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}
