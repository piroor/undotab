#!/bin/sh

appname=undotab

cp makexpi/makexpi.sh ./
./makexpi.sh -n $appname -o
rm ./makexpi.sh

