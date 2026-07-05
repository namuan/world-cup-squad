import { MapContainer, TileLayer, GeoJSON, useMap, Polyline, Tooltip, CircleMarker, Popup, Rectangle } from 'react-leaflet'
import type { LatLngBoundsExpression, PathOptions, Map } from 'leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useMemo, useRef, useState, useEffect } from 'react'
import squadData from '../data/squads.json'
import countriesGeoJSON from '../data/countries.json'
import clubCoords from '../data/club_coords.json'

const TEAM_TO_GEOJSON: Record<string, string> = {
  Algeria: 'Algeria',
  Argentina: 'Argentina',
  Australia: 'Australia',
  Austria: 'Austria',
  Belgium: 'Belgium',
  'Bosnia and Herzegovina': 'Bosnia and Herzegovina',
  Brazil: 'Brazil',
  Canada: 'Canada',
  'Cape Verde': 'Cabo Verde',
  Colombia: 'Colombia',
  Croatia: 'Croatia',
  'Curaçao': 'Curaçao',
  'Czech Republic': 'Czechia',
  'DR Congo': 'Democratic Republic of the Congo',
  Ecuador: 'Ecuador',
  England: 'United Kingdom',
  France: 'France',
  Egypt: 'Egypt',
  Germany: 'Germany',
  Ghana: 'Ghana',
  Haiti: 'Haiti',
  Iran: 'Iran',
  Iraq: 'Iraq',
  'Ivory Coast': 'Ivory Coast',
  Japan: 'Japan',
  Jordan: 'Jordan',
  Mexico: 'Mexico',
  Morocco: 'Morocco',
  Netherlands: 'Netherlands',
  'New Zealand': 'New Zealand',
  Norway: 'Norway',
  Panama: 'Panama',
  Paraguay: 'Paraguay',
  Portugal: 'Portugal',
  Qatar: 'Qatar',
  'Saudi Arabia': 'Saudi Arabia',
  Scotland: 'United Kingdom',
  Senegal: 'Senegal',
  'South Africa': 'South Africa',
  'South Korea': 'South Korea',
  Spain: 'Spain',
  Sweden: 'Sweden',
  Switzerland: 'Switzerland',
  Tunisia: 'Tunisia',
  Turkey: 'Turkey',
  'United States': 'United States of America',
  Uruguay: 'Uruguay',
  Uzbekistan: 'Uzbekistan',
}

const clubCoordMap = clubCoords as Record<string, { lat: number; lng: number }>

const CLUB_COUNTRY_MAP: Record<string, string> = {
  England: 'United Kingdom',
  Scotland: 'United Kingdom',
  Wales: 'United Kingdom',
  USA: 'United States of America',
  UAE: 'United Arab Emirates',
  'Czech Republic': 'Czechia',
  Serbia: 'Republic of Serbia',
  'Republic of Ireland': 'Ireland',
}

const FLAG_COLORS: Record<string, string> = {
  Algeria: '#006633',
  Argentina: '#75aadb',
  Australia: '#00008b',
  Austria: '#ed2939',
  Belgium: '#fdda24',
  'Bosnia and Herzegovina': '#0038a8',
  Brazil: '#009739',
  Canada: '#ff0000',
  'Cabo Verde': '#003893',
  Colombia: '#fcd116',
  Croatia: '#ff0000',
  Curaçao: '#00a8d7',
  Czechia: '#d7141a',
  'Democratic Republic of the Congo': '#007fff',
  Ecuador: '#ffdd00',
  'United Kingdom': '#ce1124',
  France: '#002654',
  Egypt: '#ce1126',
  Germany: '#ffcc00',
  Ghana: '#fcd116',
  Haiti: '#00209f',
  Iran: '#239f40',
  Iraq: '#ce1126',
  'Ivory Coast': '#f77f00',
  Japan: '#bc002d',
  Jordan: '#007a3d',
  Mexico: '#006847',
  Morocco: '#c1272d',
  Netherlands: '#ae1c28',
  'New Zealand': '#00247d',
  Norway: '#ba0c2f',
  Panama: '#005293',
  Paraguay: '#0038a8',
  Portugal: '#046a38',
  Qatar: '#8a1538',
  'Saudi Arabia': '#006c35',
  Senegal: '#00853f',
  'South Africa': '#007a4d',
  'South Korea': '#cd2e3a',
  Spain: '#f1bf00',
  Sweden: '#006aa7',
  Switzerland: '#ff0000',
  Tunisia: '#e70013',
  Turkey: '#e30a17',
  'United States of America': '#b22234',
  Uruguay: '#0038a8',
  Uzbekistan: '#0099b5',
}

const MAX_BOUNDS: LatLngBoundsExpression = [
  [-90, -180],
  [90, 180],
]

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
    const geom = f.geometry
    if (!geom) continue
    try {
      let coords: number[][]
      if (geom.type === 'Polygon') {
        coords = geom.coordinates[0] as number[][]
      } else if (geom.type === 'MultiPolygon') {
        const polys = geom.coordinates as number[][][][]
        coords = polys.reduce((a, b) => (b[0].length > a.length ? b[0] : a), polys[0][0])
      } else {
        continue
      }
      let latSum = 0
      let lngSum = 0
      for (const c of coords) {
        latSum += c[1]
        lngSum += c[0]
      }
      centers[name] = L.latLng(latSum / coords.length, lngSum / coords.length)
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
  players: { name: string; club: string }[]
}

function MapInit({ onMap, onZoom }: { onMap: (map: Map) => void; onZoom?: (zoom: number) => void }) {
  const map = useMap()
  useEffect(() => {
    onMap(map)
    if (onZoom) {
      onZoom(map.getZoom())
      const handler = () => onZoom(map.getZoom())
      map.on('zoomend', handler)
      return () => { map.off('zoomend', handler) }
    }
  }, [map, onMap, onZoom])
  return null
}

function WorldMap() {
  const geoData = countriesGeoJSON as GeoJSON.GeoJsonObject
  const features = (geoData as GeoJSON.FeatureCollection).features
  const mapRef = useRef<Map | null>(null)
  const [hoveredCountry, setHoveredCountry] = useState<string | null>(null)
  const selectedRef = useRef<string | null>(null)
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null)
  const [zoom, setZoom] = useState(3)

  const setSelected = (name: string | null) => {
    selectedRef.current = name
    setSelectedCountry(name)
  }

  const activeCountry = selectedCountry || hoveredCountry

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

  function mergeNearbyArcs(arcs: ConnectionArc[]): ConnectionArc[] {
    const threshold = 0.04 // merge destinations within ~4.5 km
    const merged: ConnectionArc[] = []
    for (const arc of arcs) {
      let found = false
      for (const existing of merged) {
        const dlat = arc.to.lat - existing.to.lat
        const dlng = arc.to.lng - existing.to.lng
        if (Math.sqrt(dlat * dlat + dlng * dlng) < threshold) {
          existing.players = [...existing.players, ...arc.players]
          existing.count += arc.count
          const uniqueClubs = [...new Set(existing.players.map((p) => p.club))]
          existing.toName =
            uniqueClubs.length === 1
              ? uniqueClubs[0]
              : `${uniqueClubs.length} clubs`
          if (arc.to.lat > existing.to.lat) {
            existing.to = arc.to
          }
          found = true
          break
        }
      }
      if (!found) {
        merged.push({ ...arc, players: [...arc.players] })
      }
    }
    return merged
  }

  const connectionArcs = useMemo(() => {
    const grouped: Record<string, ConnectionArc[]> = {}

    for (const squad of squadData.world_cup_2026_squads) {
      const teamGeoName = TEAM_TO_GEOJSON[squad.team]
      if (!teamGeoName) continue
      const teamCenter = countryCenters[teamGeoName]
      if (!teamCenter) continue

      const teamColor = FLAG_COLORS[teamGeoName] || '#64748b'
      const destMap: Record<string, { center: L.LatLng; toName: string; players: { name: string; club: string }[] }> = {}

      for (const player of squad.players) {
        const clubName = player.club
        if (!clubName) continue

        const rawClub = player.club_country
        const clubGeoName = rawClub ? resolveGeoName(rawClub) : null

        const coord = clubCoordMap[clubName]
        const destCenter = coord
          ? L.latLng(coord.lat, coord.lng)
          : (clubGeoName ? countryCenters[clubGeoName] : undefined)
        if (!destCenter) continue

        const key = coord
          ? `${coord.lat.toFixed(2)},${coord.lng.toFixed(2)}`
          : `${clubGeoName}:${clubName}`

        if (!destMap[key]) {
          destMap[key] = { center: destCenter, toName: clubGeoName || '', players: [] }
        }
        destMap[key].players.push({ name: player.name, club: clubName })
      }

      const arcs: ConnectionArc[] = []
      for (const [, dest] of Object.entries(destMap)) {
        if (dest.players.length > 0) {
          const uniqueClubs = [...new Set(dest.players.map((p) => p.club))]
          const label =
            uniqueClubs.length === 1
              ? uniqueClubs[0]
              : `${uniqueClubs.length} clubs`
          arcs.push({
            from: teamCenter,
            to: dest.center,
            toName: label,
            color: teamColor,
            count: dest.players.length,
            players: dest.players,
          })
        }
      }

      // Merge arcs whose destinations are very close (<~3 km) to avoid
      // overlapping labels when multiple clubs share the same city.
      const merged = mergeNearbyArcs(arcs)

      if (merged.length > 0) {
        grouped[teamGeoName] = merged
      }
    }
    return grouped
  }, [countryCenters])

  const visibleArcs = activeCountry ? (connectionArcs[activeCountry] || []) : []

  const teamDestinations = useMemo(() => {
    const dests: Record<string, Set<string>> = {}
    for (const [teamName, arcs] of Object.entries(connectionArcs)) {
      const d = new Set<string>()
      for (const arc of arcs) {
        if (arc.toName) d.add(arc.toName)
      }
      dests[teamName] = d
    }
    return dests
  }, [connectionArcs])

  const focusedCountries = useMemo(() => {
    if (!activeCountry) return null
    const set = new Set<string>()
    set.add(activeCountry)
    const dests = teamDestinations[activeCountry]
    if (dests) {
      for (const d of dests) set.add(d)
    }
    return set
  }, [activeCountry, teamDestinations])

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
        if (name && qualifiedCountries.has(name)) {
          const isSelecting = selectedRef.current !== name
          setSelected(isSelecting ? name : null)
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
      <MapInit onMap={(m) => {
        mapRef.current = m
        m.on('click', () => setSelected(null))
      }} onZoom={setZoom} />
      <TileLayer url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png" />
      <GeoJSON
        data={geoData}
        filter={(feature) => filterFeature(feature as GeoJSON.Feature)}
        style={(feature) => countryStyle(feature as GeoJSON.Feature)}
        onEachFeature={onEachFeature as (feature: GeoJSON.Feature, layer: L.Layer) => void}
      />
      {visibleArcs.map((arc, i) => {
        const count = arc.players.length
        const markerRadius = Math.min(3 + count * 0.15, 10)

        const showPlayerLabels = zoom >= 7
        const effectiveZoom = Math.min(zoom, 10)
        const ppd = 256 * Math.pow(2, effectiveZoom) / 360

        // Vertical list: club name at top, players stacked below, single column
        const rowHDeg = 2 / ppd
        const headerGapDeg = 10 / ppd
        const totalH = headerGapDeg + (count - 1) * rowHDeg
        const headerLat = arc.to.lat + totalH / 2

        const padDeg = 6 / ppd
        const bottomLat = headerLat - headerGapDeg - (count - 1) * rowHDeg
        const boxBounds: LatLngBoundsExpression = showPlayerLabels
          ? [
              [bottomLat - padDeg, arc.to.lng - padDeg],
              [headerLat + padDeg, arc.to.lng + padDeg],
            ]
          : [[0, 0], [0, 0]]

        return (
          <div key={i}>
            <Polyline
              positions={getArcPoints(arc.from, arc.to, 30)}
              color={arc.color}
              weight={1 + count * 0.2}
              opacity={0.25}
              smoothFactor={1}
              interactive={false}
            />
            <CircleMarker
              center={arc.to}
              radius={markerRadius}
              fillColor={arc.color}
              fillOpacity={0.6}
              color="#ffffff"
              weight={1}
              opacity={0.9}
              stroke={true}
              interactive={true}
            >
              {!showPlayerLabels && (
                <Tooltip permanent direction="auto" className="club-label" offset={[6, 0]}>
                  <span style={{ fontWeight: 600 }}>{arc.toName}</span>
                  <span style={{ marginLeft: 4, opacity: 0.55 }}>
                    · {count}
                  </span>
                </Tooltip>
              )}
              <Popup className="club-popup">
                <div className="popup-scroll">
                  {arc.players.map((p, j) => (
                    <div key={j} className="popup-row">
                      <div className="popup-name">{p.name}</div>
                      <div className="popup-club">{p.club}</div>
                    </div>
                  ))}
                </div>
              </Popup>
            </CircleMarker>
            {showPlayerLabels && (
              <>
                <Rectangle
                  bounds={boxBounds}
                  color={arc.color}
                  weight={1}
                  opacity={0.18}
                  fillColor={arc.color}
                  fillOpacity={0.05}
                  interactive={false}
                />
                {/* Club name — top of the list */}
                <CircleMarker
                  center={L.latLng(headerLat, arc.to.lng)}
                  radius={0}
                  fillOpacity={0}
                  opacity={0}
                  stroke={false}
                  interactive={false}
                >
                  <Tooltip permanent direction="center" className="club-name-label" offset={[0, 0]}>
                    {arc.toName}
                  </Tooltip>
                </CircleMarker>
                {/* Players — vertical column below club name */}
                {arc.players.map((player, j) => (
                  <CircleMarker
                    key={`p-${j}`}
                    center={L.latLng(headerLat - headerGapDeg - j * rowHDeg, arc.to.lng)}
                    radius={0}
                    fillOpacity={0}
                    opacity={0}
                    stroke={false}
                    interactive={false}
                  >
                    <Tooltip permanent direction="center" className="player-name-label" offset={[0, 0]}>
                      {player.name}
                    </Tooltip>
                  </CircleMarker>
                ))}
              </>
            )}
          </div>
        )
      })}
    </MapContainer>
  )
}

export default function App() {
  return <WorldMap />
}
