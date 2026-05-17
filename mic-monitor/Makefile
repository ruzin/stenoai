ARCH ?= $(shell uname -m)
DEPLOYMENT_TARGET ?= 12.3
OUT := ../bin/mic-monitor

.PHONY: all clean

all: $(OUT)

$(OUT): mic_monitor.swift
	@mkdir -p ../bin
	swiftc -O -target $(ARCH)-apple-macos$(DEPLOYMENT_TARGET) \
		-framework CoreAudio -framework AppKit \
		-o $@ $<
	@codesign --sign - $@ 2>/dev/null || true
	@file $@

clean:
	rm -f $(OUT)
