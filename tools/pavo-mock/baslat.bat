@echo off
rem Ekranli sahte Pavo N86 (kasa). Kapatmak icin pencereyi kapatin.
cd /d "%~dp0..\.."
start "" http://localhost:4568/_mock/ui
dart run tools/pavo-mock/pavo_mock_server.dart --port 4568 --serial PAVMOCK00001 --name "Market Pavo" --interactive
