import { Elysia, t } from "elysia";

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";

// Munich coordinates — single-user API, location is fixed
const DEFAULT_LAT = 48.137;
const DEFAULT_LON = 11.575;

// WMO Weather interpretation codes → human-readable descriptions
const WMO_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snowfall",
  73: "Moderate snowfall",
  75: "Heavy snowfall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

function describeWeatherCode(code: number): string {
  return WMO_CODES[code] ?? `Unknown (${code})`;
}

interface OpenMeteoResponse {
  current: Record<string, number>;
  hourly: Record<string, (number | null)[]>;
  daily: Record<string, (number | string | null)[]>;
}

async function fetchForecast(): Promise<OpenMeteoResponse> {
  const params = new URLSearchParams({
    latitude: String(DEFAULT_LAT),
    longitude: String(DEFAULT_LON),
    current:
      "temperature_2m,apparent_temperature,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,precipitation,weather_code,relative_humidity_2m",
    hourly:
      "temperature_2m,apparent_temperature,precipitation_probability,precipitation,cloud_cover,uv_index,wind_speed_10m,wind_direction_10m,weather_code",
    daily:
      "temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max,weather_code,sunrise,sunset",
    forecast_hours: "48",
    forecast_days: "7",
    timezone: "auto",
  });

  const res = await fetch(`${OPEN_METEO_BASE}?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo API error: ${res.status}`);
  return res.json() as Promise<OpenMeteoResponse>;
}

// --- Response schemas ---

const CurrentSchema = t.Object({
  time: t.String(),
  temperature: t.Number({ description: "°C" }),
  feels_like: t.Number({ description: "°C" }),
  humidity: t.Number({ description: "%" }),
  cloud_cover: t.Number({ description: "%" }),
  wind_speed: t.Number({ description: "km/h" }),
  wind_direction: t.Number({ description: "degrees" }),
  wind_gusts: t.Number({ description: "km/h" }),
  uv_index: t.Number(),
  precipitation: t.Number({ description: "mm" }),
  condition: t.String({ description: "Human-readable weather condition" }),
});

const HourlyEntrySchema = t.Object({
  time: t.String(),
  temperature: t.Number(),
  feels_like: t.Number(),
  precipitation_probability: t.Number({ description: "%" }),
  precipitation: t.Number({ description: "mm" }),
  cloud_cover: t.Number({ description: "%" }),
  uv_index: t.Number(),
  wind_speed: t.Number({ description: "km/h" }),
  wind_direction: t.Number({ description: "degrees" }),
  condition: t.String(),
});

const DailyEntrySchema = t.Object({
  date: t.String(),
  temp_max: t.Number({ description: "°C" }),
  temp_min: t.Number({ description: "°C" }),
  feels_like_max: t.Number({ description: "°C" }),
  feels_like_min: t.Number({ description: "°C" }),
  precipitation_sum: t.Number({ description: "mm total" }),
  precipitation_probability: t.Number({ description: "% max" }),
  wind_max: t.Number({ description: "km/h" }),
  wind_gusts_max: t.Number({ description: "km/h" }),
  uv_index_max: t.Number(),
  condition: t.String(),
  sunrise: t.String(),
  sunset: t.String(),
});

const ForecastSchema = t.Object({
  location: t.String(),
  current: CurrentSchema,
  hourly_48h: t.Array(HourlyEntrySchema),
  daily_7d: t.Array(DailyEntrySchema),
});

// --- Transform Open-Meteo response to clean format ---

function transformResponse(raw: OpenMeteoResponse) {
  const { current: c, hourly: h, daily: d } = raw;

  const current = {
    time: String(c.time),
    temperature: c.temperature_2m,
    feels_like: c.apparent_temperature,
    humidity: c.relative_humidity_2m,
    cloud_cover: c.cloud_cover,
    wind_speed: c.wind_speed_10m,
    wind_direction: c.wind_direction_10m,
    wind_gusts: c.wind_gusts_10m,
    uv_index: c.uv_index,
    precipitation: c.precipitation,
    condition: describeWeatherCode(c.weather_code),
  };

  const times = h.time as unknown as string[];
  const hourly_48h = times.map((time, i) => ({
    time,
    temperature: (h.temperature_2m[i] as number) ?? 0,
    feels_like: (h.apparent_temperature[i] as number) ?? 0,
    precipitation_probability: (h.precipitation_probability[i] as number) ?? 0,
    precipitation: (h.precipitation[i] as number) ?? 0,
    cloud_cover: (h.cloud_cover[i] as number) ?? 0,
    uv_index: (h.uv_index[i] as number) ?? 0,
    wind_speed: (h.wind_speed_10m[i] as number) ?? 0,
    wind_direction: (h.wind_direction_10m[i] as number) ?? 0,
    condition: describeWeatherCode((h.weather_code[i] as number) ?? 0),
  }));

  const dates = d.time as unknown as string[];
  const daily_7d = dates.map((date, i) => ({
    date,
    temp_max: (d.temperature_2m_max[i] as number) ?? 0,
    temp_min: (d.temperature_2m_min[i] as number) ?? 0,
    feels_like_max: (d.apparent_temperature_max[i] as number) ?? 0,
    feels_like_min: (d.apparent_temperature_min[i] as number) ?? 0,
    precipitation_sum: (d.precipitation_sum[i] as number) ?? 0,
    precipitation_probability: (d.precipitation_probability_max[i] as number) ?? 0,
    wind_max: (d.wind_speed_10m_max[i] as number) ?? 0,
    wind_gusts_max: (d.wind_gusts_10m_max[i] as number) ?? 0,
    uv_index_max: (d.uv_index_max[i] as number) ?? 0,
    condition: describeWeatherCode((d.weather_code[i] as number) ?? 0),
    sunrise: String(d.sunrise[i]),
    sunset: String(d.sunset[i]),
  }));

  return { location: "Munich, Germany", current, hourly_48h, daily_7d };
}

export const weatherRoutes = new Elysia({ prefix: "/weather" })

  .get(
    "/forecast",
    async () => {
      const raw = await fetchForecast();
      return transformResponse(raw);
    },
    {
      response: ForecastSchema,
      detail: {
        tags: ["Weather"],
        summary:
          "Full weather forecast — current conditions, 48h hourly detail, 7-day daily overview",
        description:
          "Data from Open-Meteo (no API key). Location: Munich. Includes temperature, feels-like, rain, cloud cover, UV index, wind speed/direction/gusts, and human-readable conditions. Weather codes translated from WMO standard.",
        security: [{ BearerAuth: [] }],
      },
    },
  );
