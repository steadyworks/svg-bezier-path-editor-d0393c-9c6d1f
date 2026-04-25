#!/bin/bash
set -e

cd /app/frontend
npm install
npm run dev &
