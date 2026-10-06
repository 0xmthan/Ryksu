import { useCallback, useEffect, useState } from 'react'

export type SavedLocation = {
  id: string
  name: string
  x: number
  y: number
  z: number
}

export function useSavedLocations() {
  const [locations, setLocations] = useState<SavedLocation[]>([])

  useEffect(() => {
    const stored = localStorage.getItem('savedLocations')
    if (stored) {
      try {
        setLocations(JSON.parse(stored))
      } catch (error) {
        console.error('Failed to load saved locations', error)
      }
    }
  }, [])

  const saveLocation = useCallback((name: string, x: number, y: number, z: number) => {
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
      localStorage.setItem('savedLocations', JSON.stringify(newLocations))
      return newLocations
    })
  }, [])

  const deleteLocation = useCallback((id: string) => {
    setLocations((current) => {
      const newLocations = current.filter((loc) => loc.id !== id)
      localStorage.setItem('savedLocations', JSON.stringify(newLocations))
      return newLocations
    })
  }, [])

  return {
    locations,
    saveLocation,
    deleteLocation,
  }
}
