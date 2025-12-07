/**
 * Glucose Analytics Module
 *
 * Calculates statistics, time-in-range, GMI, and pattern recognition
 */
import { GlucoseReading, GlucoseStats, GlucoseTrends, LibreLinkConfig } from './types.js';
export declare class GlucoseAnalytics {
    private config;
    constructor(config: LibreLinkConfig);
    /**
     * Calculate comprehensive glucose statistics
     */
    calculateGlucoseStats(readings: GlucoseReading[]): GlucoseStats;
    /**
     * Analyze glucose trends and patterns
     */
    analyzeTrends(readings: GlucoseReading[], period: 'daily' | 'weekly' | 'monthly'): GlucoseTrends;
    /**
     * Group readings by hour of day
     */
    private groupByHour;
    /**
     * Detect dawn phenomenon
     */
    private detectDawnPhenomenon;
    /**
     * Calculate overnight stability (standard deviation of overnight readings)
     */
    private calculateOvernightStability;
    /**
     * Analyze meal response (glucose rise after typical meal times)
     */
    private analyzeMealResponse;
    /**
     * Update configuration
     */
    updateConfig(newConfig: Partial<LibreLinkConfig>): void;
}
