#!/bin/bash
# Stops whatever is listening on the three dashboard ports.
for p in 5050 5211 50000 8790; do pid=$(lsof -ti tcp:$p -sTCP:LISTEN); [ -n "$pid" ] && kill $pid && echo "  stopped :$p"; done; true
