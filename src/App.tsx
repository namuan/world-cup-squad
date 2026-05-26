import { MapContainer, TileLayer, GeoJSON, useMap, Polyline, Tooltip, CircleMarker } from 'react-leaflet'
import type { LatLngBoundsExpression, PathOptions, Map } from 'leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useMemo, useRef, useState, useEffect } from 'react'
import squadData from '../data/squads.json'
import countriesGeoJSON from '../data/countries.json'

const TEAM_TO_GEOJSON: Record<string, string> = {
  Belgium: 'Belgium',
  'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
  Brazil: 'Brazil',
  'Cape Verde': 'Cabo Verde',
  Croatia: 'Croatia',
  Curacao: 'Curaçao',
  'DR Congo': 'Democratic Republic of the Congo',
  England: 'United Kingdom',
  France: 'France',
  Egypt: 'Egypt',
  Germany: 'Germany',
  Haiti: 'Haiti',
  'Ivory Coast': 'Ivory Coast',
  Japan: 'Japan',
  'New Zealand': 'New Zealand',
  Norway: 'Norway',
  Portugal: 'Portugal',
  Scotland: 'United Kingdom',
  Senegal: 'Senegal',
  'South Korea': 'South Korea',
  Spain: 'Spain',
  Sweden: 'Sweden',
  Switzerland: 'Switzerland',
  Tunisia: 'Tunisia',
}

const CLUB_COUNTRY_MAP: Record<string, string> = {
  England: 'United Kingdom',
  Scotland: 'United Kingdom',
  Wales: 'United Kingdom',
  USA: 'United States of America',
  UAE: 'United Arab Emirates',
  'Czech Republic': 'Czechia',
  Serbia: 'Republic of Serbia',
}

const FLAG_COLORS: Record<string, string> = {
  Belgium: '#fdda24',
  'Bosnia and Herzegovina': '#0038a8',
  Brazil: '#009739',
  'Cabo Verde': '#003893',
  Croatia: '#ff0000',
  Curaçao: '#00a8d7',
  'Democratic Republic of the Congo': '#007fff',
  'United Kingdom': '#ce1124',
  France: '#002654',
  Egypt: '#ce1126',
  Germany: '#ffcc00',
  Haiti: '#00209f',
  'Ivory Coast': '#f77f00',
  Japan: '#bc002d',
  'New Zealand': '#00247d',
  Norway: '#ba0c2f',
  Portugal: '#046a38',
  Senegal: '#00853f',
  'South Korea': '#cd2e3a',
  Spain: '#f1bf00',
  Sweden: '#006aa7',
  Switzerland: '#ff0000',
  Tunisia: '#e70013',
}

const MAX_BOUNDS: LatLngBoundsExpression = [
  [-90, -180],
  [90, 180],
]

function getArcPointAt(start: L.LatLng, end: L.LatLng, t: number): L.LatLng {
  const midLat = (start.lat + end.lat) / 2
  const midLng = (start.lng + end.lng) / 2
  const dx = end.lng - start.lng
  const dy = end.lat - start.lat
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const offset = 0.25 * len
  const ctrlLat = midLat + (dx / len) * offset
  const ctrlLng = midLng + (-dy / len) * offset

  const lat = (1 - t) * (1 - t) * start.lat + 2 * (1 - t) * t * ctrlLat + t * t * end.lat
  const lng = (1 - t) * (1 - t) * start.lng + 2 * (1 - t) * t * ctrlLng + t * t * end.lng
  return L.latLng(lat, lng)
}

function getArcPoints(start: L.LatLng, end: L.LatLng, numPoints: number): L.LatLng[] {
  const midLat = (start.lat + end.lat) / 2
  const midLng = (start.lng + end.lng) / 2
  const dx = end.lng - start.lng
  const dy = end.lat - start.lat
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const offset = 0.25 * len
  const ctrlLat = midLat + (dx / len) * offset
  const ctrlLng = midLng + (-dy / len) * offset

  const points: L.LatLng[] = []
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints
    const lat = (1 - t) * (1 - t) * start.lat + 2 * (1 - t) * t * ctrlLat + t * t * end.lat
    const lng = (1 - t) * (1 - t) * start.lng + 2 * (1 - t) * t * ctrlLng + t * t * end.lng
    points.push(L.latLng(lat, lng))
  }
  return points
}

function getCountryCenter(features: GeoJSON.Feature[]): Record<string, L.LatLng> {
  const centers: Record<string, L.LatLng> = {}
  for (const f of features) {
    const name = f.properties?.name
    if (!name) continue
    try {
      const layer = L.geoJSON(f)
      centers[name] = layer.getBounds().getCenter()
    } catch {
      //
    }
  }
  return centers
}

function resolveGeoName(name: string): string {
  return CLUB_COUNTRY_MAP[name] || name
}

type ConnectionArc = {
  from: L.LatLng
  to: L.LatLng
  toName: string
  color: string
  count: number
  players: string[]
}

function MapInit({ onMap }: { onMap: (map: Map) => void }) {
  const map = useMap()
  useEffect(() => {
    onMap(map)
  }, [map, onMap])
  return null
}

function WorldMap() {
  const geoData = countriesGeoJSON as GeoJSON.GeoJsonObject
  const features = (geoData as GeoJSON.FeatureCollection).features
  const mapRef = useRef<Map | null>(null)
  const [hoveredCountry, setHoveredCountry] = useState<string | null>(null)

  const qualifiedCountries = useMemo(() => {
    const teams = squadData.world_cup_2026_squads.map((s) => s.team)
    const geoNames = new Set<string>()
    for (const team of teams) {
      const mapped = TEAM_TO_GEOJSON[team]
      if (mapped) geoNames.add(mapped)
    }
    return geoNames
  }, [])

  const countryCenters = useMemo(() => getCountryCenter(features), [features])

  const connectionArcs = useMemo(() => {
    const grouped: Record<string, ConnectionArc[]> = {}

    for (const squad of squadData.world_cup_2026_squads) {
      const teamGeoName = TEAM_TO_GEOJSON[squad.team]
      if (!teamGeoName) continue
      const teamCenter = countryCenters[teamGeoName]
      if (!teamCenter) continue

      const teamColor = FLAG_COLORS[teamGeoName] || '#64748b'
      const destMap: Record<string, { center: L.LatLng; players: string[] }> = {}

      for (const player of squad.players) {
        const rawClub = player.club_country
        if (!rawClub) continue
        const clubGeoName = resolveGeoName(rawClub)
        if (!clubGeoName || clubGeoName === teamGeoName) continue
        const clubCenter = countryCenters[clubGeoName]
        if (!clubCenter) continue

        if (!destMap[clubGeoName]) {
          destMap[clubGeoName] = { center: clubCenter, players: [] }
        }
        destMap[clubGeoName].players.push(player.name)
      }

      const arcs: ConnectionArc[] = []
      for (const [clubGeoName, dest] of Object.entries(destMap)) {
        if (dest.players.length > 0) {
          arcs.push({
            from: teamCenter,
            to: dest.center,
            toName: clubGeoName,
            color: teamColor,
            count: dest.players.length,
            players: dest.players,
          })
        }
      }

      if (arcs.length > 0) {
        grouped[teamGeoName] = arcs
      }
    }
    return grouped
  }, [countryCenters])

  const visibleArcs = hoveredCountry ? (connectionArcs[hoveredCountry] || []) : []

  const teamDestinations = useMemo(() => {
    const dests: Record<string, Set<string>> = {}
    for (const [teamName, arcs] of Object.entries(connectionArcs)) {
      const d = new Set<string>()
      for (const arc of arcs) {
        d.add(arc.toName)
      }
      dests[teamName] = d
    }
    return dests
  }, [connectionArcs])

  const focusedCountries = useMemo(() => {
    if (!hoveredCountry) return null
    const set = new Set<string>()
    set.add(hoveredCountry)
    const dests = teamDestinations[hoveredCountry]
    if (dests) {
      for (const d of dests) set.add(d)
    }
    return set
  }, [hoveredCountry, teamDestinations])

  function filterFeature(feature: GeoJSON.Feature | undefined): boolean {
    const name = feature?.properties?.name
    return name ? qualifiedCountries.has(name) : false
  }

  function countryStyle(feature: GeoJSON.Feature | undefined): PathOptions {
    const name = feature?.properties?.name
    const color = name ? FLAG_COLORS[name] : null
    const isFocused = !focusedCountries || focusedCountries.has(name!)
    if (color) {
      return {
        fillColor: color,
        fillOpacity: isFocused ? 0.5 : 0.08,
        color: color,
        weight: 0.5,
        opacity: isFocused ? 1 : 0.15,
      }
    }
    return { fillColor: 'transparent', fillOpacity: 0, color: 'transparent', weight: 0 }
  }

  function onEachFeature(feature: GeoJSON.Feature, layer: L.Layer) {
    const name = feature.properties?.name
    if (name) {
      layer.bindTooltip(name, { sticky: true, className: 'country-tooltip' })
      layer.on('mouseover', () => {
        setHoveredCountry(name)
      })
      layer.on('mouseout', () => {
        setHoveredCountry(null)
      })
      layer.on('click', (e: L.LeafletEvent) => {
        L.DomEvent.stop(e)
        const map = mapRef.current
        if (map) {
          map.fitBounds((layer as L.Polyline).getBounds(), { padding: [20, 20], maxZoom: 6 })
        }
      })
    }
  }

  return (
    <MapContainer
      center={[15, 10]}
      zoom={3}
      maxBounds={MAX_BOUNDS}
      maxBoundsViscosity={1.0}
      minZoom={2}
      style={{ width: '100%', height: '100%', background: '#f1f5f9' }}
      zoomControl={false}
      attributionControl={false}
    >
      <MapInit onMap={(m) => { mapRef.current = m }} />
      <TileLayer url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png" />
      <GeoJSON
        data={geoData}
        filter={(feature) => filterFeature(feature as GeoJSON.Feature)}
        style={(feature) => countryStyle(feature as GeoJSON.Feature)}
        onEachFeature={onEachFeature as (feature: GeoJSON.Feature, layer: L.Layer) => void}
      />
      {visibleArcs.map((arc, i) => {
        const count = arc.players.length
        const step = 1 / (count + 1)
        return (
          <div key={i}>
            <Polyline
              positions={getArcPoints(arc.from, arc.to, 30)}
              color={arc.color}
              weight={1 + count * 0.2}
              opacity={0.25}
              smoothFactor={1}
            />
            {arc.players.map((player, j) => {
              const t = step * (j + 1)
              return (
                <CircleMarker
                  key={j}
                  center={getArcPointAt(arc.from, arc.to, t)}
                  radius={0}
                  fillOpacity={0}
                  opacity={0}
                  stroke={false}
                >
                  <Tooltip permanent direction="center" className="player-label">
                    {player}
                  </Tooltip>
                </CircleMarker>
              )
            })}
          </div>
        )
      })}
    </MapContainer>
  )
}

export default function App() {
  return <WorldMap />
}
