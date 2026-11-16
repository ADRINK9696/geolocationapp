import React, { useEffect, useState } from "react";
import { ActivityIndicator, StatusBar, Text, View } from "react-native";
import MapView, { Marker } from "react-native-maps";
import * as Location from "expo-location";
import styles from "./styles";

MapView.Marker = Marker;

StatusBar.setBarStyle("dark-content");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

function distanceMeters(from, to) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

function formatDistance(meters) {
  const miles = meters / 1609.344;
  if (miles < 0.1) {
    return `${Math.round(meters)} m away`;
  }
  return `${miles.toFixed(1)} miles away`;
}

function formatAddress(place) {
  if (!place) {
    return "Address unavailable";
  }
  if (place.formattedAddress) {
    return place.formattedAddress;
  }

  const line = [place.streetNumber, place.street].filter(Boolean).join(" ");
  const parts = [place.name, line, place.city, place.region, place.postalCode].filter(
    Boolean
  );
  return [...new Set(parts)].join(", ") || "Address unavailable";
}

function regionFor(points) {
  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.8, 0.02),
    longitudeDelta: Math.max((maxLon - minLon) * 1.8, 0.02),
  };
}

async function findNearbyRestaurant(latitude, longitude) {
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="restaurant"](around:5000,${latitude},${longitude});
      way["amenity"="restaurant"](around:5000,${latitude},${longitude});
    );
    out center 40;
  `;

  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "GeoLocationApp/1.0 (school assignment)",
    },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error("Restaurant lookup failed");
  }

  const json = await response.json();
  const here = { latitude, longitude };
  const places = (json.elements || [])
    .map((element) => {
      const lat = element.lat ?? element.center?.lat;
      const lon = element.lon ?? element.center?.lon;
      const name = element.tags?.name;
      if (lat == null || lon == null || !name) {
        return null;
      }
      return {
        name,
        cuisine: element.tags?.cuisine,
        latitude: lat,
        longitude: lon,
      };
    })
    .filter(Boolean);

  if (places.length === 0) {
    return null;
  }

  places.sort((a, b) => distanceMeters(here, a) - distanceMeters(here, b));
  const closest = places[0];
  const milesAway = formatDistance(distanceMeters(here, closest));
  const cuisine = closest.cuisine
    ? closest.cuisine.replace(/_/g, " ")
    : "Restaurant";

  return {
    ...closest,
    description: `${cuisine} · ${milesAway}`,
  };
}

export default function App() {
  const [address, setAddress] = useState("Looking up your location...");
  const [latitude, setLatitude] = useState();
  const [longitude, setLongitude] = useState();
  const [restaurant, setRestaurant] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let watcher;
    let active = true;

    async function setPosition({ coords }) {
      setLatitude(coords.latitude);
      setLongitude(coords.longitude);

      try {
        const places = await Location.reverseGeocodeAsync({
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
        if (active) {
          setAddress(formatAddress(places[0]));
        }
      } catch (lookupError) {
        console.log(lookupError.message);
      }
    }

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (!active) {
        return;
      }
      if (status !== "granted") {
        setError("Permission to access location was denied.");
        setLoading(false);
        return;
      }

      try {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Highest,
        });
        if (!active) {
          return;
        }
        await setPosition(location);

        try {
          const nearby = await findNearbyRestaurant(
            location.coords.latitude,
            location.coords.longitude
          );
          if (active) {
            setRestaurant(nearby);
          }
        } catch (lookupError) {
          console.log(lookupError.message);
          if (active) {
            setError("Could not look up a nearby restaurant.");
          }
        }

        watcher = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Highest,
            distanceInterval: 25,
          },
          (next) => {
            if (active) {
              setPosition(next);
            }
          }
        );
        if (!active) {
          watcher.remove();
        }
      } catch (locationError) {
        console.log(locationError.message);
        if (active) {
          setError("Could not read your current location.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
      watcher?.remove();
    };
  }, []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.message}>Finding you and a nearby restaurant...</Text>
      </View>
    );
  }

  if (latitude == null || longitude == null) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>{error || "Location is unavailable."}</Text>
      </View>
    );
  }

  const points = [{ latitude, longitude }];
  if (restaurant) {
    points.push(restaurant);
  }

  return (
    <View style={styles.container}>
      <MapView
        style={styles.mapView}
        showsPointsOfInterest={false}
        showsUserLocation
        followsUserLocation
        initialRegion={regionFor(points)}
      >
        {restaurant && (
          <MapView.Marker
            title={restaurant.name}
            description={restaurant.description}
            coordinate={{
              latitude: restaurant.latitude,
              longitude: restaurant.longitude,
            }}
          />
        )}
      </MapView>
      <View style={styles.panel}>
        <Text style={styles.label}>Your location</Text>
        <Text style={styles.value}>{address}</Text>
        <Text style={styles.value}>
          {latitude.toFixed(5)}, {longitude.toFixed(5)}
        </Text>
        <Text style={styles.label}>Nearby restaurant</Text>
        <Text style={styles.value}>
          {restaurant
            ? `${restaurant.name} — ${restaurant.description}`
            : error || "No restaurant found nearby."}
        </Text>
      </View>
    </View>
  );
}
