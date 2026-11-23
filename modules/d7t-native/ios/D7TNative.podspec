Pod::Spec.new do |s|
  s.name           = 'D7TNative'
  s.version        = '1.0.0'
  s.summary        = 'D7T native helpers: plain HTTP, Vision OCR, small key-value store'
  s.description    = 'D7T native helpers'
  s.author         = 'D7T'
  s.homepage       = 'https://github.com/byd7my/d7my-tv'
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
  s.source_files = '**/*.{h,m,mm,swift}'
end
