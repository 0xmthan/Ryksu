import React, { useEffect, useMemo, useState } from 'react'
import type { SavedLocation } from './useSavedLocations'

const distanceBetween = (
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number }
) => {
  const dx = from.x - to.x
  const dy = from.y - to.y
  const dz = from.z - to.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

const ARRIVAL_THRESHOLD = 1.5

type LocationManagerProps = {
  currentPosition: { x: number; y: number; z: number } | null
  savedLocations: SavedLocation[]
  onSaveLocation: (name: string, x: number, y: number, z: number) => void
  onDeleteLocation: (id: string) => void
  onGoToLocation: (location: SavedLocation) => void
  onCancelTravel: () => void
}

const LocationManager: React.FC<LocationManagerProps> = ({
  currentPosition,
  savedLocations,
  onSaveLocation,
  onDeleteLocation,
  onGoToLocation,
  onCancelTravel,
}) => {
  const [newLocationName, setNewLocationName] = useState('')
  const [selectedLocationId, setSelectedLocationId] = useState<string>('')
  // Track an active go-to command so we can surface travel progress.
  const [activeTravel, setActiveTravel] = useState<{
    location: SavedLocation
    startDistance: number | null
    currentDistance: number | null
    startedAt: number
  } | null>(null)

  // When the saved locations change, auto-select the first one so the Go To button
  // becomes usable without an extra click. Also ensure previously-selected id
  // still exists, otherwise pick the first available.
  useEffect(() => {
    if (!savedLocations || savedLocations.length === 0) {
      setSelectedLocationId('')
      return
    }

    setSelectedLocationId((selected) =>
      savedLocations.some((s) => s.id === selected) ? selected : savedLocations[0].id
    )
  }, [savedLocations])

  const handleSaveCurrentLocation = (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentPosition || !newLocationName.trim()) return

    onSaveLocation(newLocationName.trim(), currentPosition.x, currentPosition.y, currentPosition.z)
    setNewLocationName('')
  }

  const handleGoToLocation = () => {
    const location = savedLocations.find((loc) => loc.id === selectedLocationId)
    if (location) {
      onGoToLocation(location)
      const initialDistance = currentPosition != null ? distanceBetween(currentPosition, location) : null
      setActiveTravel({
        location,
        startDistance: initialDistance,
        currentDistance: initialDistance,
        startedAt: Date.now(),
      })
    }
  }

  const handleCancelTravel = () => {
    onCancelTravel()
    setActiveTravel(null)
  }

  // The coordinates on their own, so a new position object with the same values doesn't count as a move.
  const x = currentPosition?.x
  const y = currentPosition?.y
  const z = currentPosition?.z
  useEffect(() => {
    if (x === undefined || y === undefined || z === undefined) {
      return
    }

    setActiveTravel((previous) => {
      if (!previous) {
        return previous
      }

      const distance = distanceBetween({ x, y, z }, previous.location)

      if (!Number.isFinite(distance)) {
        return previous
      }

      if (distance <= ARRIVAL_THRESHOLD) {
        return null
      }

      const nextStartDistance =
        previous.startDistance != null && previous.startDistance >= distance
          ? previous.startDistance
          : distance

      if (
        previous.currentDistance != null &&
        Math.abs(previous.currentDistance - distance) < 0.01 &&
        nextStartDistance === previous.startDistance
      ) {
        return previous
      }

      return {
        ...previous,
        startDistance: nextStartDistance,
        currentDistance: distance,
      }
    })
  }, [x, y, z])

  useEffect(() => {
    setActiveTravel((previous) => {
      if (!previous) {
        return previous
      }

      const stillExists = savedLocations.some((loc) => loc.id === previous.location.id)
      return stillExists ? previous : null
    })
  }, [savedLocations])

  const travelProgress = useMemo(() => {
    if (!activeTravel) {
      return null
    }

    const { startDistance, currentDistance } = activeTravel
    if (startDistance == null || startDistance <= 0) {
      if (currentDistance == null) {
        return 0
      }
      return currentDistance <= ARRIVAL_THRESHOLD ? 1 : 0
    }

    if (currentDistance == null) {
      return 0
    }

    const ratio = 1 - currentDistance / startDistance
    return Math.max(0, Math.min(1, ratio))
  }, [activeTravel])

  const formattedDistance = useMemo(() => {
    if (!activeTravel || activeTravel.currentDistance == null) {
      return null
    }

    return activeTravel.currentDistance.toFixed(1)
  }, [activeTravel])

  return (
    // Fixed-width card: prevents large texts from expanding the control.
    <div
      className="w-72 max-w-72 min-w-[18rem] rounded-md border border-neutral-800 bg-neutral-900/70 px-4 py-3
        text-xs text-neutral-300"
      style={{ width: '18rem' }}
    >
      <form onSubmit={handleSaveCurrentLocation} className="flex w-full items-center gap-2">
        <input
          aria-label="Location name"
          type="text"
          value={newLocationName}
          onChange={(e) => setNewLocationName(e.target.value)}
          placeholder="Location name"
          className="min-w-0 flex-1 truncate rounded-md border border-neutral-700 bg-neutral-950/70 px-2 py-1
            text-xs text-neutral-100 focus:border-sky-500 focus:outline-none focus:ring-2
            focus:ring-sky-500/30"
        />
        <button
          type="submit"
          disabled={!currentPosition || !newLocationName.trim()}
          title="Save the bot's current position"
          className="shrink-0 rounded px-2 py-1 text-[0.68rem] uppercase tracking-[0.2em] text-sky-400
            disabled:text-neutral-600"
        >
          Save
        </button>
      </form>

      <div className="h-2" />

      <div className="flex w-full items-center gap-2">
        <select
          value={selectedLocationId}
          onChange={(e) => setSelectedLocationId(e.target.value)}
          className="flex-1 rounded-md border border-neutral-700 bg-neutral-950/70 px-2 py-1 text-xs
            text-neutral-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
          aria-label="Saved locations"
        >
          {savedLocations.length === 0 ? (
            <option value="">No saved locations</option>
          ) : (
            savedLocations.map((loc) => (
              <option key={loc.id} value={loc.id} title={`${loc.name} (${loc.x}, ${loc.y}, ${loc.z})`}>
                {loc.name} ({Math.round(loc.x)}, {Math.round(loc.y)}, {Math.round(loc.z)})
              </option>
            ))
          )}
        </select>

        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={handleGoToLocation}
            disabled={!selectedLocationId}
            className="rounded px-2 py-1 text-[0.68rem] uppercase tracking-[0.2em] text-sky-400
              disabled:text-neutral-600"
          >
            Go To
          </button>
          <button
            type="button"
            onClick={() => {
              if (!selectedLocationId) return
              onDeleteLocation(selectedLocationId)
              setSelectedLocationId('')
            }}
            disabled={!selectedLocationId}
            className="rounded px-2 py-1 text-[0.68rem] uppercase tracking-[0.2em] text-red-400
              disabled:text-neutral-600"
          >
            Delete
          </button>
        </div>
      </div>

      {activeTravel ? (
        <div className="mt-3 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[0.65rem] uppercase tracking-[0.2em] text-neutral-400">
              Traveling to {activeTravel.location.name}
            </div>
            <button
              type="button"
              onClick={handleCancelTravel}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-neutral-700
                text-neutral-400 transition hover:border-red-500 hover:text-red-400 focus-visible:outline
                focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              aria-label="Cancel travel"
            >
              &times;
            </button>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
            <div
              className="h-full rounded-full bg-sky-500 transition-all duration-200 ease-out"
              style={{ width: `${((travelProgress ?? 0) * 100).toFixed(0)}%` }}
            />
          </div>
          <div className="text-[0.65rem] text-neutral-500">
            {formattedDistance ? `${formattedDistance} blocks away` : 'Awaiting position...'}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default LocationManager
