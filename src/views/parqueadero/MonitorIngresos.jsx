import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CAlert,
  CBadge,
  CButton,
  CCard,
  CCardBody,
  CCardHeader,
  CCol,
  CFormInput,
  CRow,
  CSpinner,
} from '@coreui/react'
import CIcon from '@coreui/icons-react'
import { cilCamera, cilCarAlt, cilCheckCircle, cilReload, cilWarning } from '@coreui/icons'
import { createWorker } from 'tesseract.js'

import { useVehiculos } from '../../hooks/useVehiculos'
import { supabase } from '../../lib/supabase'

const COLUMNAS = ['A', 'B', 'C', 'D']

const MonitorIngresos = () => {
  const { vehiculos } = useVehiculos()
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const workerRef = useRef(null)
  const ocrProcesandoRef = useRef(false)
  const [puestos, setPuestos] = useState([])
  const [cargandoPuestos, setCargandoPuestos] = useState(true)
  const [errorPuestos, setErrorPuestos] = useState('')
  const [placa, setPlaca] = useState('')
  const [procesando, setProcesando] = useState(false)
  const [camaraActiva, setCamaraActiva] = useState(false)
  const [mensaje, setMensaje] = useState('')

  useEffect(() => {
    let activo = true

    const cargarPuestos = async () => {
      setCargandoPuestos(true)
      const { data, error } = await supabase
        .from('puestos')
        .select('id, codigo, columna, numero, estado, distancia_cm, ultima_actualizacion')
        .order('codigo')

      if (!activo) return
      if (error) setErrorPuestos(error.message)
      else setPuestos(data ?? [])
      setCargandoPuestos(false)
    }

    cargarPuestos()
    const canal = supabase
      .channel('monitor-puestos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'puestos' }, (cambio) => {
        setPuestos((actuales) => {
          if (cambio.eventType === 'DELETE') {
            return actuales.filter((puesto) => puesto.id !== cambio.old.id)
          }
          const nuevo = cambio.new
          const existe = actuales.some((puesto) => puesto.id === nuevo.id)
          return existe
            ? actuales.map((puesto) => (puesto.id === nuevo.id ? nuevo : puesto))
            : [...actuales, nuevo].sort((a, b) => a.codigo.localeCompare(b.codigo))
        })
      })
      .subscribe()

    return () => {
      activo = false
      supabase.removeChannel(canal)
    }
  }, [])

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), [])

  const procesarFotograma = useCallback(async () => {
    if (!videoRef.current?.videoWidth || !workerRef.current || ocrProcesandoRef.current) return

    ocrProcesandoRef.current = true
    setProcesando(true)
    const canvas = document.createElement('canvas')
    canvas.width = videoRef.current.videoWidth
    canvas.height = videoRef.current.videoHeight
    canvas.getContext('2d').drawImage(videoRef.current, 0, 0, canvas.width, canvas.height)

    try {
      const resultado = await workerRef.current.recognize(canvas, {
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
      })
      setMensaje(resultado.data.text)
      const lectura = resultado.data.text
        .toUpperCase()
        .replace(/\s/g, '')
        .match(/[A-Z]{3}-?\d{4}/)?.[0]
      if (lectura) {
        const placaDetectada =
          lectura.length === 7 ? `${lectura.slice(0, 3)}-${lectura.slice(3)}` : lectura
        setPlaca(placaDetectada)
        setMensaje(`Placa detectada automáticamente: ${placaDetectada}`)
      }
    } catch {
      setMensaje('El OCR no pudo procesar el fotograma actual: ' + resultado.data.text)
    } finally {
      ocrProcesandoRef.current = false
      setProcesando(false)
    }
  }, [])

  useEffect(() => {
    if (!camaraActiva) return undefined

    let cancelado = false
    let intervalo
    const iniciarOCR = async () => {
      try {
        workerRef.current = await createWorker('eng')
        if (cancelado) {
          await workerRef.current.terminate()
          workerRef.current = null
          return
        }
        setMensaje('OCR activo. Buscando placas automáticamente...')
        procesarFotograma()
        intervalo = setInterval(procesarFotograma, 2000)
      } catch {
        setMensaje('No se pudo iniciar el OCR automático.')
      }
    }

    iniciarOCR()
    return () => {
      cancelado = true
      clearInterval(intervalo)
      const worker = workerRef.current
      workerRef.current = null
      worker?.terminate()
    }
  }, [camaraActiva, procesarFotograma])

  const vehiculoDetectado = useMemo(
    () => vehiculos.find((vehiculo) => vehiculo.placa === placa.trim().toUpperCase()),
    [vehiculos, placa],
  )

  const iniciarCamara = async () => {
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      videoRef.current.srcObject = streamRef.current
      await videoRef.current.play()
      setCamaraActiva(true)
      setMensaje('Cámara lista. Centra la placa y captura la imagen.')
    } catch {
      setMensaje('No fue posible acceder a la cámara. Revisa los permisos del navegador.')
    }
  }

  const detectarPlaca = async () => {
    if (!camaraActiva || !videoRef.current?.videoWidth) {
      setMensaje('Activa la cámara antes de capturar.')
      return
    }
    if (!workerRef.current) {
      setMensaje('El OCR todavía se está iniciando. Intenta de nuevo en un momento.')
      return
    }
    setMensaje('Analizando imagen actual...')
    await procesarFotograma()
  }

  const puestosPorColumna = (columna) => puestos.filter((puesto) => puesto.columna === columna)
  const ocupados = puestos.filter((puesto) => puesto.estado === 'OCUPADO').length

  return (
    <div className="parking-monitor">
      <div className="d-flex justify-content-between align-items-start gap-3 mb-4">
        <div>
          <div className="text-uppercase small fw-semibold text-success">Control de acceso</div>
          <h1 className="h3 mb-1">Monitor de ingresos</h1>
          <p className="text-body-secondary mb-0">
            Lectura en vivo de sensores y placas del estacionamiento.
          </p>
        </div>
        <CBadge color="success" className="px-3 py-2">
          <span className="monitor-live-dot" /> EN VIVO
        </CBadge>
      </div>

      {errorPuestos && (
        <CAlert color="warning">
          <CIcon icon={cilWarning} className="me-2" />
          No se pudieron consultar los puestos: {errorPuestos}
        </CAlert>
      )}

      <CRow className="g-3 mb-4">
        {COLUMNAS.map((columna) => {
          const puestosColumna = puestosPorColumna(columna)
          const puestoCercano = puestosColumna
            .filter((puesto) => puesto.estado === 'DISPONIBLE')
            .sort((a, b) => a.numero - b.numero)[0]
          return (
            <CCol xs={12} sm={6} xl={3} key={columna}>
              <CCard className="h-100 monitor-column-card">
                <CCardBody>
                  <div className="d-flex flex-column align-items-center gap-3">
                    <span className="monitor-column-label">{columna}</span>
                    <div className="monitor-nearest-slot">
                      <span>Puesto disponible</span>
                      <strong>{puestoCercano?.codigo || 'Sin disponibilidad'}</strong>
                    </div>
                  </div>
                </CCardBody>
              </CCard>
            </CCol>
          )
        })}
      </CRow>

      <CRow className="g-4">
        <CCol xs={12} lg={7}>
          <CCard className="h-100">
            <CCardHeader className="d-flex justify-content-between align-items-center">
              <strong>
                <CIcon icon={cilCamera} className="me-2" />
                Cámara de acceso
              </strong>
              <span className="small text-body-secondary">{ocupados} vehículos dentro</span>
            </CCardHeader>
            <CCardBody>
              <div className="monitor-camera-frame">
                <video ref={videoRef} muted playsInline aria-label="Vista de cámara para OCR" />
                {!camaraActiva && (
                  <div className="monitor-camera-placeholder">
                    <CIcon icon={cilCamera} size="3xl" />
                    <span>Vista de cámara inactiva</span>
                  </div>
                )}
                {camaraActiva && (
                  <span className="monitor-camera-guide">Alinea la placa dentro del encuadre</span>
                )}
              </div>
              <div className="d-flex flex-wrap gap-2 mt-3">
                <CButton color="dark" onClick={iniciarCamara} disabled={camaraActiva}>
                  <CIcon icon={cilCamera} className="me-2" />
                  Activar cámara
                </CButton>
                <CButton
                  color="success"
                  onClick={detectarPlaca}
                  disabled={!camaraActiva || procesando}
                >
                  {procesando ? (
                    <CSpinner size="sm" className="me-2" />
                  ) : (
                    <CIcon icon={cilCheckCircle} className="me-2" />
                  )}
                  Detectar placa
                </CButton>
              </div>
              {mensaje && <div className="small text-body-secondary mt-3">{mensaje}</div>}
            </CCardBody>
          </CCard>
        </CCol>

        <CCol xs={12} lg={5}>
          <CCard className="h-100">
            <CCardHeader>
              <strong>
                <CIcon icon={cilCarAlt} className="me-2" />
                Vehículo detectado
              </strong>
            </CCardHeader>
            <CCardBody>
              <CFormInput
                value={placa}
                onChange={(evento) => setPlaca(evento.target.value.toUpperCase())}
                placeholder="Placa detectada, ej. RAA-1001"
                className="mb-3"
              />
              {vehiculoDetectado ? (
                <div className="monitor-vehicle-result">
                  <img
                    src={vehiculoDetectado.foto_url}
                    alt={`${vehiculoDetectado.marca} ${vehiculoDetectado.modelo}`}
                  />
                  <div className="flex-grow-1">
                    <CBadge color="dark" className="fs-6 mb-2">
                      {vehiculoDetectado.placa}
                    </CBadge>
                    <h2 className="h5 mb-1">
                      {vehiculoDetectado.marca} {vehiculoDetectado.modelo}
                    </h2>
                    <div className="small text-body-secondary">
                      {vehiculoDetectado.anio} · {vehiculoDetectado.color} ·{' '}
                      {vehiculoDetectado.tipo}
                    </div>
                    <hr />
                    <div className="small fw-semibold">{vehiculoDetectado.propietario_nombre}</div>
                    <div className="small text-body-secondary">
                      {vehiculoDetectado.cedula_enmascarada}
                    </div>
                    <a className="small" href={`mailto:${vehiculoDetectado.correo_institucional}`}>
                      {vehiculoDetectado.correo_institucional}
                    </a>
                  </div>
                  <img
                    className="monitor-owner-photo"
                    src={vehiculoDetectado.foto_propietario_url}
                    alt={`Propietario: ${vehiculoDetectado.propietario_nombre}`}
                  />
                </div>
              ) : (
                <div className="monitor-empty-result">
                  <CIcon icon={cilReload} size="xl" />
                  <p className="mb-0 mt-2">Espera una lectura o busca una placa manualmente.</p>
                </div>
              )}
            </CCardBody>
          </CCard>
        </CCol>
      </CRow>
      {cargandoPuestos && (
        <div className="small text-body-secondary mt-3">
          <CSpinner size="sm" className="me-2" />
          Sincronizando puestos...
        </div>
      )}
    </div>
  )
}

export default MonitorIngresos
