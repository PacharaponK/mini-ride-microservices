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
    { id: 2, name: 'Saga Orchestrator', tech: 'Node.js', port: '3004', desc: 'ควบคุม SAGA Flow' },
    { id: 3, name: 'Pricing Service', tech: 'Go + gRPC', port: '3002', desc: 'คำนวณราคา' },
    { id: 4, name: 'Payment Service', tech: 'Python/FastAPI', port: '3003', desc: 'ชำระเงิน' },
    { id: 5, name: 'Matching Service', tech: 'Node.js', port: '3001', desc: 'ยืนยัน Ride' },
  ]

  const addLog = (step, message, type = 'info') => {
    setLogs(prev => [...prev, { step, message, type, time: new Date().toLocaleTimeString() }])
  }

  const pollSagaStatus = async (sagaId, maxAttempts = 10) => {
    for (let i = 0; i < maxAttempts; i++) {
      await delay(1000)
      const response = await fetch(`/api/saga/${sagaId}`)
      const saga = await response.json()

      if (saga.status === 'COMPLETED') {
        return saga
      } else if (saga.status === 'COMPENSATED' || saga.status === 'FAILED') {
        throw new Error(`SAGA ${saga.status}: ${saga.error || 'Transaction rolled back'}`)
      }
    }
    throw new Error('SAGA timeout: Please check saga status manually')
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
      addLog(1, 'Frontend ส่ง POST /api/saga/ride-booking', 'send')
      await delay(300)
      addLog(1, 'API Gateway forward ไป Saga Orchestrator', 'receive')

      // Step 2: Saga Orchestrator
      setCurrentStep(2)
      addLog(2, '🎭 Saga Orchestrator เริ่ม transaction', 'receive')
      await delay(300)

      // Actual API call to SAGA
      const response = await fetch('/api/saga/ride-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          riderId,
          pickupLocation: { lat: parseFloat(pickup.lat), lng: parseFloat(pickup.lng) },
          dropoffLocation: { lat: parseFloat(dropoff.lat), lng: parseFloat(dropoff.lng) }
        })
      })

      const sagaData = await response.json()

      if (!response.ok) {
        throw new Error(sagaData.error || 'เกิดข้อผิดพลาด')
      }

      addLog(2, `📝 SAGA ID: ${sagaData.sagaId}`, 'info')
      addLog(2, 'จอง Driver จาก Matching...', 'db')

      // Step 3: Pricing
      setCurrentStep(3)
      addLog(3, '📡 เรียก Pricing ผ่าน gRPC', 'grpc')
      await delay(400)
      addLog(3, '✅ คำนวณราคาเสร็จสิ้น', 'grpc')

      // Step 4: Payment
      setCurrentStep(4)
      addLog(4, '💳 ดำเนินการชำระเงิน...', 'send')
      await delay(400)
      addLog(4, '✅ ชำระเงินสำเร็จ', 'db')

      // Step 5: Confirm Ride
      setCurrentStep(5)
      addLog(5, '✅ ยืนยัน Ride กับ Matching Service', 'success')

      // Poll for saga completion
      const finalResult = await pollSagaStatus(sagaData.sagaId)

      addLog(1, '🎉 SAGA สำเร็จ! ส่งผลลัพธ์กลับ Frontend', 'success')
      setResult(finalResult)
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
            <h3>✅ ผลลัพธ์ (SAGA Pattern)</h3>

            <div className="result-grid">
              <div className="result-box">
                <span className="result-label">SAGA ID</span>
                <span className="result-value">{result._id}</span>
              </div>
              <div className="result-box">
                <span className="result-label">สถานะ</span>
                <span className="result-value status">{result.status}</span>
              </div>
            </div>

            <div className="result-section">
              <h4>🚗 คนขับ (Step 1: Reserve Driver)</h4>
              <div className="info-box">
                <p><strong>{result.steps?.[0]?.result?.driver?.name}</strong></p>
                <p>{result.steps?.[0]?.result?.driver?.vehicle} • {result.steps?.[0]?.result?.driver?.plate}</p>
              </div>
            </div>

            <div className="result-section">
              <h4>💰 ราคา (Step 2: Calculate Price via gRPC)</h4>
              <div className="price-box">
                <div className="price-row">
                  <span>ค่าเริ่มต้น</span>
                  <span>{result.steps?.[1]?.result?.baseFare} ฿</span>
                </div>
                <div className="price-row">
                  <span>ระยะทาง {result.steps?.[1]?.result?.distanceKm?.toFixed(2)} km</span>
                  <span>{result.steps?.[1]?.result?.distanceFee?.toFixed(0)} ฿</span>
                </div>
                <div className="price-row total">
                  <span>รวม</span>
                  <span>{result.steps?.[1]?.result?.total?.toFixed(0)} {result.steps?.[1]?.result?.currency}</span>
                </div>
              </div>
            </div>

            <div className="result-section">
              <h4>💳 ชำระเงิน (Step 3: Process Payment)</h4>
              <div className="info-box">
                <p><strong>Payment ID:</strong> {result.steps?.[2]?.result?.paymentId}</p>
                <p><strong>สถานะ:</strong> ✅ {result.steps?.[2]?.result?.status}</p>
              </div>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="legend">
          <h4>📚 คำอธิบาย (SAGA Architecture)</h4>
          <div className="legend-grid">
            <div className="legend-item"><span className="tech-node">Node.js</span> API Gateway + Saga Orchestrator</div>
            <div className="legend-item"><span className="tech-go">Go/gRPC</span> Pricing (sync)</div>
            <div className="legend-item"><span className="tech-python">Python</span> Payment</div>
            <div className="legend-item"><span className="tech-node">Node.js</span> Matching (SAGA participant)</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
