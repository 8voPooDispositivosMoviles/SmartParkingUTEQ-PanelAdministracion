const express = require('express')
const path = require('node:path')

const app = express()
const PORT = process.env.PORT || 8080

app.get('/health', (req, res) => {
  res.status(200).send('OK')
})

app.use(express.static(path.join(__dirname, 'build')))

// Permite acceder directamente a las rutas de React.
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'))
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Smart Parking ejecutándose en el puerto ${PORT}`)
})