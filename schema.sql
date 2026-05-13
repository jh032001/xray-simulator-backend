CREATE DATABASE IF NOT EXISTS xray_simulator;
USE xray_simulator;

CREATE TABLE IF NOT EXISTS estudiantes (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    nombre     VARCHAR(100) NOT NULL,
    apellido   VARCHAR(100) NOT NULL,
    semestre   INT          NOT NULL,
    creado_en  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS respuestas (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    estudiante_id INT          NOT NULL,
    tipo          ENUM('pre','post') NOT NULL,
    pregunta      INT          NOT NULL,
    respuesta     INT          NOT NULL,
    correcta      BOOLEAN      NOT NULL,
    creado_en     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (estudiante_id) REFERENCES estudiantes(id)
);
