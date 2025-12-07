export interface LibreLinkConfig {
    email: string;
    password: string;
    region: 'US' | 'EU' | 'DE' | 'FR' | 'AP' | 'AU';
    targetLow: number;
    targetHigh: number;
    clientVersion: string;
}
export interface GlucoseReading {
    value: number;
    timestamp: string;
    trend: TrendType;
    trendArrow: number;
    isHigh: boolean;
    isLow: boolean;
    color: 'green' | 'yellow' | 'orange' | 'red';
}
export type TrendType = 'SingleDown' | 'FortyFiveDown' | 'Flat' | 'FortyFiveUp' | 'SingleUp' | 'NotComputable' | 'RateOutOfRange';
export interface GlucoseStats {
    average: number;
    gmi: number;
    timeInRange: number;
    timeBelowRange: number;
    timeAboveRange: number;
    standardDeviation: number;
    coefficientOfVariation: number;
    readingCount: number;
}
export interface GlucoseTrends {
    patterns: string[];
    dawnPhenomenon: boolean;
    mealResponse: number;
    overnightStability: number;
}
export interface SensorInfo {
    sn: string;
    activatedOn: number;
    expiresOn: number;
    status: string;
}
export interface Connection {
    id: string;
    patientId: string;
    firstName: string;
    lastName: string;
    targetLow: number;
    targetHigh: number;
    sensor: {
        sn: string;
        a: number;
        w: number;
    };
    glucoseMeasurement: RawGlucoseItem;
}
export interface RawGlucoseItem {
    FactoryTimestamp: string;
    Timestamp: string;
    type: number;
    ValueInMgPerDl: number;
    TrendArrow?: number;
    MeasurementColor: number;
    GlucoseUnits: number;
    Value: number;
    isHigh: boolean;
    isLow: boolean;
}
export interface GraphResponse {
    connection: Connection;
    activeSensors: Array<{
        sensor: {
            sn: string;
            a: number;
            w: number;
        };
        device: {
            did: string;
            v: string;
        };
    }>;
    graphData: RawGlucoseItem[];
}
export declare const TREND_MAP: Record<number, TrendType>;
export declare function getGlucoseColor(value: number, targetLow: number, targetHigh: number): 'green' | 'yellow' | 'orange' | 'red';
export declare const LIBRE_LINK_SERVERS: Record<string, string>;
