import { DateTime } from 'luxon';

export type DateAndStatus = {
  date: DateTime;
  isAvailable: boolean;
};

export interface ICampground {
  getName(): string;
}

export interface ICampsite {
  getAvailableDates(): DateAndStatus[];
  getName(): string;
  getUrl(): string;
}

export interface SearchResult {
  isError: boolean;
}

export interface ErrorSearchResult extends SearchResult {
  message: string;
}

export interface ValidSearchResult extends SearchResult {
  args: {
    api: string;
    campgrounds: string[];
    startDayOfWeek: number;
    lengthOfStay: number;
    monthsToCheck: number;  
  };
  startDay: string;
  results: Result[]
}

export interface Result {
  campgroundName: string;
  results: ResultCampgrounds
}

export interface ResultCampgrounds {
  [date: string]: ResultUnit[];
}

export interface ResultUnit {
  name: string;
  url?: string;
}
