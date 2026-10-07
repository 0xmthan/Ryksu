import { useCallback, useEffect, useState } from 'react'

export type SavedLocation = {
  id: string
  name: string
  x: number
  y: number
  z: number
}

// The connected server's saved locations, kept under `key` (see makeLocationsStorageKey).
export function useSavedLocations(key: string) {
  const [locations, setLocations] = useState<SavedLocation[]>([])

  useEffect(() => {
    const stored = window.ryksuStore.getItem(key)
    try {
      setLocations(stored ? JSON.parse(stored) : [])
    } catch (error) {
      console.error('Failed to load saved locations', error)
    }
  }, [key])

  const saveLocation = useCallback(
    (name: string, x: number, y: number, z: number) => {
      setLocations((current) => {
        const newLocations = [
          ...current,
          {
            id: Date.now().toString(),
            name,
            x,
            y,
            z,
          },
        ]
        window.ryksuStore.setItem(key, JSON.stringify(newLocations))
        return newLocations
      })
    },
    [key]
  )

  const deleteLocation = useCallback(
    (id: string) => {
      setLocations((current) => {
        const newLocations = current.filter((loc) => loc.id !== id)
        window.ryksuStore.setItem(key, JSON.stringify(newLocations))
        return newLocations
      })
    },
    [key]
  )

  return {
    locations,
    saveLocation,
    deleteLocation,
  }
}
