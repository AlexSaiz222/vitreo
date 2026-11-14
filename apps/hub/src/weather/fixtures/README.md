# Respuestas de AEMET para los tests (A10)

Con la forma que documenta AEMET OpenData: campos de `observacion/convencional` (`idema`, `fint` en UTC, `ta`, `hr`, `vv`, `vmax`, `dv`, `prec`, `vis`), la previsión horaria con horas locales (`fecha` + `periodo`), `Ip` para "inapreciable" y el viento en km/h. Los tests nunca usan la red.

Hechas a mano mientras no había clave (13/10/2026), solo con una estación del centro de Madrid y el municipio de Madrid (28079): datos públicos que no dicen nada de la casa. Con la clave, se comparan con una respuesta real antes de dar A10 por cerrado (docs/09).
