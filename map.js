import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import mapboxgl from "https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm";
import { MAPBOX_TOKEN } from "./config.js";

const BLUEBIKES_STATIONS_URL =
    "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";
const BLUEBIKES_TRAFFIC_URL =
    "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv";
const BOSTON_BIKE_LANES_URL =
    "https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson";
const CAMBRIDGE_BIKE_LANES_URL =
    "https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson";

let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

mapboxgl.accessToken = MAPBOX_TOKEN;

const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/streets-v12",
    center: [-71.09415, 42.36027],
    zoom: 12,
    minZoom: 5,
    maxZoom: 18,
});

console.log("Mapbox GL JS Loaded:", mapboxgl);

const svg = d3.select("#map").select("svg");
const bikeLaneStyle = {
    "line-color": "#32D400",
    "line-width": 3,
    "line-opacity": 0.4,
};
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat);
    const { x, y } = map.project(point);
    return { cx: x, cy: y };
}

function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes);
    return date.toLocaleString("en-US", { timeStyle: "short" });
}

function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

function filterByMinute(tripsByMinute, minute) {
    if (minute === -1) {
        return tripsByMinute.flat();
    }

    const minMinute = (minute - 60 + 1440) % 1440;
    const maxMinute = (minute + 60) % 1440;

    if (minMinute > maxMinute) {
        const beforeMidnight = tripsByMinute.slice(minMinute);
        const afterMidnight = tripsByMinute.slice(0, maxMinute);
        return beforeMidnight.concat(afterMidnight).flat();
    }

    return tripsByMinute.slice(minMinute, maxMinute).flat();
}

function computeStationTraffic(stations, timeFilter = -1) {
    const departures = d3.rollup(
        filterByMinute(departuresByMinute, timeFilter),
        (v) => v.length,
        (d) => d.start_station_id,
    );

    const arrivals = d3.rollup(
        filterByMinute(arrivalsByMinute, timeFilter),
        (v) => v.length,
        (d) => d.end_station_id,
    );

    return stations.map((station) => {
        const id = station.short_name;
        station.arrivals = arrivals.get(id) ?? 0;
        station.departures = departures.get(id) ?? 0;
        station.totalTraffic = station.arrivals + station.departures;
        return station;
    });
}

function setCircleTitles(selection) {
    selection
        .select("title")
        .text(
            (d) =>
                `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
        );
}

map.on("load", async () => {
    map.addSource("boston_route", {
        type: "geojson",
        data: BOSTON_BIKE_LANES_URL,
    });

    map.addLayer({
        id: "boston-bike-lanes",
        type: "line",
        source: "boston_route",
        paint: bikeLaneStyle,
    });

    map.addSource("cambridge_route", {
        type: "geojson",
        data: CAMBRIDGE_BIKE_LANES_URL,
    });

    map.addLayer({
        id: "cambridge-bike-lanes",
        type: "line",
        source: "cambridge_route",
        paint: bikeLaneStyle,
    });

    let jsonData;
    try {
        jsonData = await d3.json(BLUEBIKES_STATIONS_URL);
        console.log("Loaded JSON Data:", jsonData);
    } catch (error) {
        console.error("Error loading JSON:", error);
        return;
    }

    await d3.csv(BLUEBIKES_TRAFFIC_URL, (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);

        const startedMinutes = minutesSinceMidnight(trip.started_at);
        departuresByMinute[startedMinutes].push(trip);

        const endedMinutes = minutesSinceMidnight(trip.ended_at);
        arrivalsByMinute[endedMinutes].push(trip);

        return trip;
    });

    const stations = computeStationTraffic(jsonData.data.stations);
    console.log("Stations Array:", stations);

    const radiusScale = d3
        .scaleSqrt()
        .domain([0, d3.max(stations, (d) => d.totalTraffic)])
        .range([0, 25]);

    let circles = svg
        .selectAll("circle")
        .data(stations, (d) => d.short_name)
        .enter()
        .append("circle")
        .attr("r", (d) => radiusScale(d.totalTraffic))
        .style("--departure-ratio", (d) =>
            stationFlow(
                d.totalTraffic === 0 ? 0.5 : d.departures / d.totalTraffic,
            ),
        );

    circles.append("title");
    setCircleTitles(circles);

    function updatePositions() {
        circles
            .attr("cx", (d) => getCoords(d).cx)
            .attr("cy", (d) => getCoords(d).cy);
    }

    function updateScatterPlot(timeFilter) {
        const filteredStations = computeStationTraffic(stations, timeFilter);

        timeFilter === -1
            ? radiusScale.range([0, 25])
            : radiusScale.range([3, 50]);

        circles = svg
            .selectAll("circle")
            .data(filteredStations, (d) => d.short_name)
            .join("circle")
            .attr("r", (d) => radiusScale(d.totalTraffic))
            .style("--departure-ratio", (d) =>
                stationFlow(
                    d.totalTraffic === 0 ? 0.5 : d.departures / d.totalTraffic,
                ),
            );

        circles
            .selectAll("title")
            .data((d) => [d])
            .join("title");
        setCircleTitles(circles);
        updatePositions();
    }

    updatePositions();

    map.on("move", updatePositions);
    map.on("zoom", updatePositions);
    map.on("resize", updatePositions);
    map.on("moveend", updatePositions);

    const timeSlider = document.getElementById("time-slider");
    const selectedTime = document.getElementById("selected-time");
    const anyTimeLabel = document.getElementById("any-time");

    function updateTimeDisplay() {
        const timeFilter = Number(timeSlider.value);

        if (timeFilter === -1) {
            selectedTime.textContent = "";
            anyTimeLabel.style.display = "block";
        } else {
            selectedTime.textContent = formatTime(timeFilter);
            anyTimeLabel.style.display = "none";
        }

        updateScatterPlot(timeFilter);
    }

    timeSlider.addEventListener("input", updateTimeDisplay);
    updateTimeDisplay();
});
