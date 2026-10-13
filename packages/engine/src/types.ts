/** The kinds of water problem a citizen can report. */
export const ISSUE_TYPES = ['NO_WATER', 'LOW_PRESSURE', 'DIRTY_WATER', 'LEAK'] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

/**
 * Issues are grouped into families. Complaints only cluster with others in the
 * same family: "no water" and "low pressure" are the same supply failure seen
 * by different households, but "dirty water" is a health problem with a
 * different response, so it must never be hidden inside a supply incident.
 */
export type IssueFamily = 'SUPPLY' | 'QUALITY' | 'INFRASTRUCTURE';

export const FAMILY_OF: Record<IssueType, IssueFamily> = {
  NO_WATER: 'SUPPLY',
  LOW_PRESSURE: 'SUPPLY',
  DIRTY_WATER: 'QUALITY',
  LEAK: 'INFRASTRUCTURE',
};

export interface LatLng {
  lat: number;
  lng: number;
}

/** One citizen report. `createdAt` is epoch milliseconds. */
export interface Complaint extends LatLng {
  id: string;
  reporterId: string;
  issueType: IssueType;
  createdAt: number;
}

/** A group of complaints that point at the same underlying problem. */
export interface Cluster {
  /** Stable id: family + the earliest complaint in the group. */
  id: string;
  family: IssueFamily;
  complaintIds: string[];
  /** Report times, ascending. Used for velocity and duration scoring. */
  reportedAt: number[];
  issueBreakdown: Partial<Record<IssueType, number>>;
  centroid: LatLng;
  /** Distance from the centroid to the furthest complaint, in metres. */
  radiusMeters: number;
  complaintCount: number;
  firstReportedAt: number;
  lastReportedAt: number;
}

export type SeverityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** One line of the score explanation, so an officer can see WHY. */
export interface SeverityFactor {
  name: 'volume' | 'spread' | 'velocity' | 'duration' | 'issue type';
  points: number;
  max: number;
  detail: string;
}

export interface Severity {
  /** 0 to 100. */
  score: number;
  level: SeverityLevel;
  factors: SeverityFactor[];
}

export interface Incident extends Cluster {
  severity: Severity;
  recommendedAction: string;
}
