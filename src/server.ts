#!/usr/bin/env node
import * as Koa from 'koa';
import * as Router from 'koa-router';

import { DateTime } from 'luxon';
import { DateAndStatus, ErrorSearchResult, ICampground, ICampsite, Result, ResultCampgrounds, ResultUnit, ValidSearchResult } from './types';
import * as RecreationGov from './apis/recreation_gov/recreation_gov';
import * as ReserveCA from './apis/reserve_ca/reserve_california';

const PORT = 19090;

function matchAvailableDateRanges(
  availabilities: DateAndStatus[],
  startDayOfWeek: number,
  lengthOfStay: number,
) {
  const sortedAvailabilities = availabilities.sort((a, b) => a.date.diff(b.date).as('days'));
  const result: DateRange[] = [];

  let sequenceStart: DateTime | null = null;
  let sequenceLength = 0;

  sortedAvailabilities.forEach((availability) => {
    if (sequenceStart) {
      if (sequenceLength === lengthOfStay) {
        const sequenceEnd = availability.date;
        result.push({ start: sequenceStart, end: sequenceEnd });
        sequenceStart = null;
        sequenceLength = 0;
      } else if (availability.isAvailable && sequenceLength < lengthOfStay) {
        sequenceLength += 1;
      } else {
        sequenceStart = null;
        sequenceLength = 0;
      }
    } else if (availability.date.weekday === startDayOfWeek && availability.isAvailable) {
      sequenceStart = availability.date;
      sequenceLength += 1;
    }
  });

  return result;
}

function makeAvailabilityKey(availability: DateRange) {
  const { start, end } = availability;
  const startFmt = start.toLocaleString(DateTime.DATE_SHORT);
  const endFmt = end.toLocaleString(DateTime.DATE_SHORT);
  return `${startFmt} to ${endFmt}`;
}

type DateRange = { start: DateTime; end: DateTime };

type Itinerary = {
  range: DateRange;
  campsites: ICampsite[];
};

function consolidateItineraries(
  matches: {
    site: ICampsite;
    matchingRanges: DateRange[];
  }[],
): Itinerary[] {
  const result: Record<string, { range: DateRange; campsites: ICampsite[] }> = {};

  matches.forEach((match) => {
    match.matchingRanges.forEach((availability) => {
      const key = makeAvailabilityKey(availability);

      if (!result[key]) {
        result[key] = {
          range: availability,
          campsites: [],
        };
      }

      result[key].campsites.push(match.site);
    });
  });

  return Object.values(result).sort((a, b) => a.range.start.diff(b.range.end).as('days'));
}

interface ReservationAPI {
  getCampground(campgroundId: string): Promise<ICampground | null>;
  getCampsites(campgroundId: string, monthsToCheck: number): Promise<ICampsite[]>;
}

async function search(
  provider: APIChoice,
  campgroundId: string,
  startDayOfWeek: number,
  lengthOfStay: number,
  monthsToCheck: number,
): Promise<Result> {
  const api = pickAPI(provider);
  const campground = await api.getCampground(campgroundId);

  if (!campground) {
    throw new Error(`No campground with id ${campgroundId}`);
  }

  const campsites = await api.getCampsites(campgroundId, monthsToCheck) as any;

  const matches = campsites
    .map((site: any) => {
      const availabilities = site.getAvailableDates();
      const matchingRanges = matchAvailableDateRanges(availabilities, startDayOfWeek, lengthOfStay);

      return { site, matchingRanges };
    })
    .filter((site: any) => site.matchingRanges.length > 0);

  const regrouped = consolidateItineraries(matches);

  const results: ResultCampgrounds = {};
  const searchResult =  {
    campgroundName: campground.getName(),
    results
  };

  if (regrouped.length > 0) {
    regrouped.forEach(({ range, campsites }) => {
      const units: ResultUnit[] = [];
      const { start } = range;

      campsites.forEach((site) => {
        const unit: ResultUnit = {
          name: site.getName()
        };
        if (provider !== APIChoice.ReserveCA) {
          unit.url = site.getUrl();
        }
        units.push(unit);
      });
      results[start.toISODate()] = units;
    });
  }

  return searchResult;
}

enum APIChoice {
  RecreationGov = 'recreation_gov',
  ReserveCA = 'reserve_ca',
}

type Argv = {
  api: APIChoice;
  campground: string;
  day: string;
  nights: number;
  months: number;
};

function pickAPI(choice: APIChoice) {
  return choice === APIChoice.RecreationGov ? RecreationGov : ReserveCA;
}

async function main(argv: Argv) {
  try {
    const result = await search(argv.api, argv.campground, dayToWeekday(argv.day), argv.nights, argv.months);
    console.log(JSON.stringify(result));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

function dayToWeekday(day: string) {
  return ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(day) + 1;
}

function weekdayToDay(weekday: number) {
  return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][
    weekday - 1
  ];
}

if (require.main === module) {
  const app = new Koa();
  const router = new Router();

  router.get('/search', async (ctx, next) => {
    let {
      api,
      campground,
    } = ctx.query;
    const weekday = parseInt(ctx.query.weekday as string);
    const nights = parseInt(ctx.query.nights as string);
    const months = parseInt(ctx.query.months as string);
    const campgrounds = Array.isArray(campground) ? campground : [campground];
    ctx.set('content-type', 'application.json');
    const results = await Promise.all(
      campgrounds.map(((campgroundId) => search(
        api === APIChoice.ReserveCA ? APIChoice.ReserveCA : APIChoice.RecreationGov,
        campgroundId as string,
        weekday,
        nights,
        months
      )))
    );
    const payload: ValidSearchResult = {
      isError: false,
      args: {
        api: api as string,
        campgrounds: campgrounds as string[],
        lengthOfStay: nights,
        monthsToCheck: months,
        startDayOfWeek: weekday,
      },
      startDay: weekdayToDay(weekday),
      results,
    };
    ctx.body = payload;
    await next();
  });

  app.use(router.routes()).use(router.allowedMethods());

  app.listen(PORT, () => console.log(`Server ready on port ${PORT}`));
}
