import { useState } from 'react'

function App() {
  const [pickup, setPickup] = useState({ lat: '13.7563', lng: '100.5018' })
  const [dropoff, setDropoff] = useState({ lat: '13.7469', lng: '100.5349' })
  const [riderId, setRiderId] = useState('rider-001')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const handleRequestRide = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/request-ride', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          riderId,
          pickupLocation: { lat: parseFloat(pickup.lat), lng: parseFloat(pickup.lng) },
          dropoffLocation: { lat: parseFloat(dropoff.lat), lng: parseFloat(dropoff.lng) }
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'เกิดข้อผิดพลาด')
      }

      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app">
      <div className="container">
        {/* Header */}
        <header className="header">
          <div className="logo">🚗</div>
          <h1>Mini Ride-Hailing</h1>
          <p className="subtitle">Microservices Demo</p>
        </header>

        {/* Form */}
        <form className="ride-form" onSubmit={handleRequestRide}>
          <div className="form-section">
            <label className="form-label">
              <span className="label-icon">👤</span>
              Rider ID
            </label>
            <input
              type="text"
              className="form-input"
              value={riderId}
              onChange={(e) => setRiderId(e.target.value)}
              placeholder="rider-001"
            />
          </div>

          <div className="form-section">
            <label className="form-label">
              <span className="label-icon">📍</span>
              จุดรับ (Pickup)
            </label>
            <div className="coord-inputs">
              <input
                type="text"
                className="form-input"
                value={pickup.lat}
                onChange={(e) => setPickup({ ...pickup, lat: e.target.value })}
                placeholder="Latitude"
              />
              <input
                type="text"
                className="form-input"
                value={pickup.lng}
                onChange={(e) => setPickup({ ...pickup, lng: e.target.value })}
                placeholder="Longitude"
              />
            </div>
          </div>

          <div className="form-section">
            <label className="form-label">
              <span className="label-icon">🎯</span>
              จุดส่ง (Dropoff)
            </label>
            <div className="coord-inputs">
              <input
                type="text"
                className="form-input"
                value={dropoff.lat}
                onChange={(e) => setDropoff({ ...dropoff, lat: e.target.value })}
                placeholder="Latitude"
              />
              <input
                type="text"
                className="form-input"
                value={dropoff.lng}
                onChange={(e) => setDropoff({ ...dropoff, lng: e.target.value })}
                placeholder="Longitude"
              />
            </div>
          </div>

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? (
              <span className="loading-spinner"></span>
            ) : (
              <>🚕 เรียกรถ</>
            )}
          </button>
        </form>

        {/* Error */}
        {error && (
          <div className="error-card">
            <span className="error-icon">⚠️</span>
            <p>{error}</p>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="result-card">
            <div className="result-header">
              <span className="status-badge status-confirmed">✓ {result.status}</span>
              <span className="ride-id">{result.rideId}</span>
            </div>

            <div className="result-section">
              <h3>🚗 คนขับ</h3>
              <div className="driver-info">
                <div className="driver-avatar">{result.driver?.name?.charAt(0) || 'D'}</div>
                <div>
                  <p className="driver-name">{result.driver?.name}</p>
                  <p className="driver-vehicle">{result.driver?.vehicle} • {result.driver?.plate}</p>
                </div>
              </div>
            </div>

            <div className="result-section">
              <h3>💰 ราคา</h3>
              <div className="price-breakdown">
                <div className="price-row">
                  <span>ค่าเริ่มต้น</span>
                  <span>{result.pricing?.breakdown?.baseFare} ฿</span>
                </div>
                <div className="price-row">
                  <span>ระยะทาง ({result.pricing?.breakdown?.distanceKm?.toFixed(2)} km)</span>
                  <span>{result.pricing?.breakdown?.distanceFee?.toFixed(0)} ฿</span>
                </div>
                <div className="price-row total">
                  <span>รวม</span>
                  <span>{result.pricing?.total?.toFixed(0)} {result.pricing?.currency}</span>
                </div>
              </div>
            </div>

            <div className="result-section">
              <h3>💳 การชำระเงิน</h3>
              <div className="payment-info">
                <span className={`payment-status ${result.payment?.status}`}>
                  {result.payment?.status === 'completed' ? '✓ ชำระแล้ว' : result.payment?.status}
                </span>
                <span className="payment-id">{result.payment?.paymentId}</span>
              </div>
            </div>

            {/* Service Flow */}
            <div className="result-section">
              <h3>🔄 Service Flow</h3>
              <div className="service-flow">
                <div className="flow-step">
                  <span className="flow-badge node">Node.js</span>
                  <span>Matching</span>
                </div>
                <span className="flow-arrow">→</span>
                <div className="flow-step">
                  <span className="flow-badge go">Go/gRPC</span>
                  <span>Pricing</span>
                </div>
                <span className="flow-arrow">→</span>
                <div className="flow-step">
                  <span className="flow-badge python">Python</span>
                  <span>Payment</span>
                </div>
                <span className="flow-arrow">→</span>
                <div className="flow-step">
                  <span className="flow-badge kafka">Kafka</span>
                  <span>Event</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="footer">
          <p>Built with Node.js • Go • Python • gRPC • Kafka • Redis</p>
        </footer>
      </div>
    </div>
  )
}

export default App
