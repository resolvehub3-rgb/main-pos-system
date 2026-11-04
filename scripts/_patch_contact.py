p='landing/src/components/Contact.tsx'
s=open(p).read()
s=s.replace("  const [selectedPackage, setSelectedPackage] = useState<string>('Not sure yet');\n", '')
s=s.replace("  const subject = `SamTill enquiry — ${selectedPackage}`;\n  const body = `${message}\\n\\nPreferred package: ${selectedPackage}`;\n", "  const subject = 'SamTill enquiry';\n  const body = message;\n")
s=s.replace("  const [message, setMessage] = useState(DEFAULT_ENQUIRY);", "  const [message, setMessage] = useState('');")
s=s.replace('                Your name (optional)', '                Your name (required)')
s=s.replace('                Your email (optional)', '                Your email (required)')
open(p,'w').write(s)
print('done')
