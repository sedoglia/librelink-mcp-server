// Types for LibreLink MCP Server

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

export type TrendType = 
  | 'SingleDown'
  | 'FortyFiveDown'
  | 'Flat'
  | 'FortyFiveUp'
  | 'SingleUp'
  | 'NotComputable'
  | 'RateOutOfRange';

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

// Trend arrow mapping
export const TREND_MAP: Record<number, TrendType> = {
  1: 'SingleDown',
  2: 'FortyFiveDown',
  3: 'Flat',
  4: 'FortyFiveUp',
  5: 'SingleUp',
  6: 'NotComputable',
  7: 'RateOutOfRange'
};

// Color mapping based on glucose value
export function getGlucoseColor(value: number, targetLow: number, targetHigh: number): 'green' | 'yellow' | 'orange' | 'red' {
  if (value < 54) return 'red';
  if (value < targetLow) return 'orange';
  if (value > 250) return 'red';
  if (value > targetHigh) return 'yellow';
  return 'green';
}

// Regional API endpoints
export const LIBRE_LINK_SERVERS: Record<string, string> = {
  'EU': 'https://api-eu.libreview.io',
  'EU2': 'https://api-eu2.libreview.io',
  'US': 'https://api-us.libreview.io',
  'DE': 'https://api-de.libreview.io',
  'FR': 'https://api-fr.libreview.io',
  'AP': 'https://api-ap.libreview.io',
  'AU': 'https://api-au.libreview.io',
  'GLOBAL': 'https://api.libreview.io'
};
