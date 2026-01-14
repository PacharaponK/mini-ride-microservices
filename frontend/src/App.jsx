import { useState } from 'react'

function App() {
  const [pickup, setPickup] = useState({ lat: '13.7563', lng: '100.5018' })
  const [dropoff, setDropoff] = useState({ lat: '13.7469', lng: '100.5349' })
  const [riderId, setRiderId] = useState('rider-001')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [currentStep, setCurrentStep] = useState(0)
  const [logs, setLogs] = useState([])

  const steps = [
    { id: 1, name: 'API Gateway', tech: 'Node.js/Express', port: '3000', desc: 'รับ request จาก Frontend' },
    { id: 2, name: 'Matching Service', tech: 'Node.js', port: '3001', desc: 'หาคนขับที่ว่าง' },
    { id: 3, name: 'Pricing Service', tech: 'Go + gRPC', port: '3002', desc: 'คำนวณราคา' },
    { id: 4, name: 'Payment Service', tech: 'Python/FastAPI', port: '3003', desc: 'ชำระเงิน' },
    { id: 5, name: 'Kafka', tech: 'Message Broker', port: '9092', desc: 'ส่ง Event แจ้งเตือน' },
  ]

  const addLog = (step, message, type = 'info') => {
    setLogs(prev => [...prev, { step, message, type, time: new Date().toLocaleTimeString() }])
  }

  const handleRequestRide = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)
    setLogs([])
    setCurrentStep(0)

    try {
      // Step 1: API Gateway
      setCurrentStep(1)
      addLog(1, 'Frontend ส่ง POST /api/request-ride', 'send')
      await delay(500)
      addLog(1, 'API Gateway รับ request และ forward ไป Matching', 'receive')

      // Step 2: Matching
      setCurrentStep(2)
      addLog(2, 'Matching Service รับ request', 'receive')
      await delay(300)
      addLog(2, 'Query หาคนขับจาก PostgreSQL...', 'db')
      await delay(300)

      // Step 3: Pricing (gRPC)
      setCurrentStep(3)
      addLog(3, '📡 เรียก Pricing ผ่าน gRPC', 'grpc')
      await delay(400)
      addLog(3, 'คำนวณระยะทาง + ราคา (MongoDB)', 'db')
      await delay(300)
      addLog(3, '✅ ส่งราคากลับ Matching', 'grpc')

      // Step 4: Payment
      setCurrentStep(4)
      addLog(4, 'เรียก Payment ผ่าน HTTP REST', 'send')
      await delay(400)
      addLog(4, 'ตัดเงินจาก wallet (PostgreSQL)', 'db')
      await delay(300)

      // Step 5: Kafka
      setCurrentStep(5)
      addLog(5, '📨 Payment ส่ง event "payment.completed"', 'kafka')
      await delay(300)
      addLog(5, '📬 Matching รับ event จาก Kafka', 'kafka')

      // Actual API call
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

      addLog(1, '✅ ส่งผลลัพธ์กลับ Frontend', 'success')
      setResult(data)
    } catch (err) {
      setError(err.message)
      addLog(currentStep, `❌ Error: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

  return (
    <div className="app">
      <div className="container">
        {/* Header */}
        <header className="header">
          <div className="logo">🚗</div>
          <h1>Mini Ride-Hailing</h1>
          <p className="subtitle">Microservices Learning Demo</p>
        </header>

        {/* Architecture Diagram */}
        <div className="architecture">
          <h3>🏗️ Service Flow</h3>
          <div className="flow-diagram">
            {steps.map((step, idx) => (
              <div key={step.id} className="flow-item">
                <div className={`flow-box ${currentStep === step.id ? 'active' : ''} ${currentStep > step.id ? 'done' : ''}`}>
                  <span className="flow-tech">{step.tech}</span>
                  <span className="flow-name">{step.name}</span>
                  <span className="flow-port">:{step.port}</span>
                </div>
                {idx < steps.length - 1 && <span className="flow-arrow">→</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Form */}
        <form className="ride-form" onSubmit={handleRequestRide}>
          <div className="form-row">
            <div className="form-section">
              <label className="form-label">👤 Rider ID</label>
              <input
                type="text"
                className="form-input"
                value={riderId}
                onChange={(e) => setRiderId(e.target.value)}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-section">
              <label className="form-label">📍 จุดรับ (Lat, Lng)</label>
              <div className="coord-inputs">
                <input type="text" className="form-input" value={pickup.lat}
                  onChange={(e) => setPickup({ ...pickup, lat: e.target.value })} />
                <input type="text" className="form-input" value={pickup.lng}
                  onChange={(e) => setPickup({ ...pickup, lng: e.target.value })} />
              </div>
            </div>
            <div className="form-section">
              <label className="form-label">🎯 จุดส่ง (Lat, Lng)</label>
              <div className="coord-inputs">
                <input type="text" className="form-input" value={dropoff.lat}
                  onChange={(e) => setDropoff({ ...dropoff, lat: e.target.value })} />
                <input type="text" className="form-input" value={dropoff.lng}
                  onChange={(e) => setDropoff({ ...dropoff, lng: e.target.value })} />
              </div>
            </div>
          </div>

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? <span className="loading-spinner"></span> : '🚕 เรียกรถ'}
          </button>
        </form>

        {/* Live Logs */}
        {logs.length > 0 && (
          <div className="logs-section">
            <h3>📋 Service Logs (Real-time)</h3>
            <div className="logs-container">
              {logs.map((log, idx) => (
                <div key={idx} className={`log-item log-${log.type}`}>
                  <span className="log-time">{log.time}</span>
                  <span className="log-step">[{steps[log.step - 1]?.name}]</span>
                  <span className="log-msg">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="error-card">
            <span>⚠️ {error}</span>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="result-card">
            <h3>✅ ผลลัพธ์</h3>

            <div className="result-grid">
              <div className="result-box">
                <span className="result-label">Ride ID</span>
                <span className="result-value">{result.rideId}</span>
              </div>
              <div className="result-box">
                <span className="result-label">สถานะ</span>
                <span className="result-value status">{result.status}</span>
              </div>
            </div>

            <div className="result-section">
              <h4>🚗 คนขับ (จาก Matching → PostgreSQL)</h4>
              <div className="info-box">
                <p><strong>{result.driver?.name}</strong></p>
                <p>{result.driver?.vehicle} • {result.driver?.plate}</p>
              </div>
            </div>

            <div className="result-section">
              <h4>💰 ราคา (จาก Pricing → gRPC → MongoDB)</h4>
              <div className="price-box">
                <div className="price-row">
                  <span>ค่าเริ่มต้น</span>
                  <span>{result.pricing?.breakdown?.baseFare} ฿</span>
                </div>
                <div className="price-row">
                  <span>ระยะทาง {result.pricing?.breakdown?.distanceKm?.toFixed(2)} km</span>
                  <span>{result.pricing?.breakdown?.distanceFee?.toFixed(0)} ฿</span>
                </div>
                <div className="price-row total">
                  <span>รวม</span>
                  <span>{result.pricing?.total?.toFixed(0)} {result.pricing?.currency}</span>
                </div>
              </div>
            </div>

            <div className="result-section">
              <h4>💳 ชำระเงิน (จาก Payment → PostgreSQL → Kafka)</h4>
              <div className="info-box">
                <p><strong>Payment ID:</strong> {result.payment?.paymentId}</p>
                <p><strong>สถานะ:</strong> ✅ {result.payment?.status}</p>
              </div>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="legend">
          <h4>📚 คำอธิบาย</h4>
          <div className="legend-grid">
            <div className="legend-item"><span className="tech-node">Node.js</span> API Gateway + Matching</div>
            <div className="legend-item"><span className="tech-go">Go/gRPC</span> Pricing (sync)</div>
            <div className="legend-item"><span className="tech-python">Python</span> Payment</div>
            <div className="legend-item"><span className="tech-kafka">Kafka</span> Events (async)</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
